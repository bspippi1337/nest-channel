const STORAGE_KEY = "nest.channel.workspace.v1";
const SETTINGS_KEY = "nest.channel.settings.v1";
const CLIENT_KEY = "nest.channel.client.v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

if (!window.NESTCore) throw new Error("NESTCore mangler. Last nest-core.js før app.js.");

const el = Object.fromEntries([
  "statusDot","statusText","peerCount","relayUrl","channelName","nickname","channelPassword",
  "connectButton","disconnectButton","channelHeading","taskForm","taskTitle","taskAssignee",
  "taskDependency","filters","searchInput","readyCount","waitingCount","doneCount","allCount",
  "taskList","chatList","chatForm","chatInput","taskDialog","dialogState","editTaskId","editTitle",
  "editAssignee","editLabels","dependencyList","addDependencySelect","addDependencyButton",
  "commentList","commentText","addCommentButton","deleteTaskButton","saveTaskButton","emptyTemplate"
].map(id => [id, document.getElementById(id)]));

const clientId = localStorage.getItem(CLIENT_KEY) || crypto.randomUUID();
localStorage.setItem(CLIENT_KEY, clientId);

let workspace = loadWorkspace();
let currentFilter = "ready";
let socket = null;
let roomId = "";
let roomKey = null;
let connectedNickname = "";

function nowIso() {
  return new Date().toISOString();
}

function blankWorkspace() {
  return { version: 2, tasks: [], chat: [], updatedAt: nowIso() };
}

function normalizeWorkspace(value) {
  if (!value || typeof value !== "object") return blankWorkspace();
  return {
    version: 2,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    tasks: Array.isArray(value.tasks) ? value.tasks.map(normalizeTask) : [],
    chat: Array.isArray(value.chat) ? value.chat.map(normalizeChat).filter(Boolean).slice(-300) : []
  };
}

function normalizeTask(task) {
  const now = nowIso();
  const updatedAt = typeof task?.updatedAt === "string" ? task.updatedAt : now;
  const fieldUpdatedAt = {};
  for (const field of NESTCore.TASK_FIELDS) {
    fieldUpdatedAt[field] = typeof task?.fieldUpdatedAt?.[field] === "string"
      ? task.fieldUpdatedAt[field]
      : updatedAt;
  }
  return {
    id: typeof task?.id === "string" ? task.id : crypto.randomUUID(),
    title: typeof task?.title === "string" ? task.title : "Uten navn",
    assignee: typeof task?.assignee === "string" ? task.assignee : "",
    done: Boolean(task?.done),
    deleted: Boolean(task?.deleted),
    labels: Array.isArray(task?.labels) ? [...new Set(task.labels.filter(v => typeof v === "string"))] : [],
    dependsOn: Array.isArray(task?.dependsOn) ? [...new Set(task.dependsOn.filter(v => typeof v === "string"))] : [],
    comments: Array.isArray(task?.comments) ? task.comments.map(normalizeComment).filter(Boolean) : [],
    createdAt: typeof task?.createdAt === "string" ? task.createdAt : now,
    updatedAt,
    fieldUpdatedAt
  };
}

function normalizeComment(comment) {
  if (!comment || typeof comment !== "object") return null;
  return {
    id: typeof comment.id === "string" ? comment.id : crypto.randomUUID(),
    author: typeof comment.author === "string" ? comment.author : "",
    text: typeof comment.text === "string" ? comment.text : "",
    createdAt: typeof comment.createdAt === "string" ? comment.createdAt : nowIso()
  };
}

function normalizeChat(message) {
  if (!message || typeof message !== "object" || typeof message.text !== "string") return null;
  return {
    id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
    author: typeof message.author === "string" ? message.author : "",
    text: message.text,
    createdAt: typeof message.createdAt === "string" ? message.createdAt : nowIso(),
    clientId: typeof message.clientId === "string" ? message.clientId : ""
  };
}

function loadWorkspace() {
  try {
    return normalizeWorkspace(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return blankWorkspace();
  }
}

function loadSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    el.relayUrl.value = settings.relayUrl || "";
    el.channelName.value = settings.channelName || "";
    el.nickname.value = settings.nickname || "";
  } catch {}
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    relayUrl: el.relayUrl.value.trim(),
    channelName: el.channelName.value.trim(),
    nickname: el.nickname.value.trim()
  }));
}

function liveTasks() {
  return workspace.tasks.filter(task => !task.deleted);
}

function taskById(id) {
  return workspace.tasks.find(task => task.id === id);
}

function taskState(task) {
  return NESTCore.taskState(workspace.tasks, task);
}

function stateText(state) {
  return ({ ready: "Klar nå", waiting: "Venter", done: "Ferdig" })[state] || state;
}

function unresolvedDependencies(task) {
  return NESTCore.unresolvedDependencies(workspace.tasks, task);
}

function wouldCreateCycle(taskId, dependencyId) {
  return NESTCore.wouldCreateCycle(workspace.tasks, taskId, dependencyId);
}

function touchTask(task, fields = [], timestamp = nowIso()) {
  task.fieldUpdatedAt ||= {};
  for (const field of fields) task.fieldUpdatedAt[field] = timestamp;
  task.updatedAt = timestamp;
}

function persist({ sync = true, renderNow = true } = {}) {
  workspace.version = 2;
  workspace.updatedAt = nowIso();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  if (renderNow) render();
  if (sync) window.dispatchEvent(new CustomEvent("nest:workspace-changed"));
}

function mergeWorkspace(remoteValue) {
  const remote = normalizeWorkspace(remoteValue);
  const tasks = new Map(workspace.tasks.map(task => [task.id, task]));
  for (const remoteTask of remote.tasks) {
    const localTask = tasks.get(remoteTask.id);
    tasks.set(remoteTask.id, normalizeTask(NESTCore.mergeTask(localTask, remoteTask)));
  }
  workspace.tasks = [...tasks.values()];
  workspace.chat = NESTCore.mergeById(workspace.chat, remote.chat, "createdAt").slice(-300);
  workspace.updatedAt = [workspace.updatedAt, remote.updatedAt].filter(Boolean).sort().at(-1) || nowIso();
  workspace.version = 2;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  render();
}

function render() {
  renderCounts();
  renderTaskOptions();
  renderTasks();
  renderChat();
  if (el.taskDialog.open) {
    const task = taskById(el.editTaskId.value);
    if (task && !task.deleted) renderDialogParts(task);
  }
}

function renderCounts() {
  const counts = { ready: 0, waiting: 0, done: 0 };
  for (const task of liveTasks()) counts[taskState(task)]++;
  el.readyCount.textContent = counts.ready;
  el.waitingCount.textContent = counts.waiting;
  el.doneCount.textContent = counts.done;
  el.allCount.textContent = liveTasks().length;
}

function renderTaskOptions() {
  const selected = el.taskDependency.value;
  el.taskDependency.replaceChildren(new Option("Kan gjøres med en gang", ""));
  liveTasks().filter(task => !task.done).sort(byCreatedAt).forEach(task => {
    el.taskDependency.add(new Option(task.title, task.id));
  });
  if ([...el.taskDependency.options].some(option => option.value === selected)) {
    el.taskDependency.value = selected;
  }
}

function renderTasks() {
  const query = el.searchInput.value.trim().toLocaleLowerCase("nb");
  const stateOrder = { ready: 0, waiting: 1, done: 2 };
  const tasks = liveTasks()
    .filter(task => currentFilter === "all" || taskState(task) === currentFilter)
    .filter(task => !query || [task.title, task.assignee, ...task.labels, ...task.comments.map(c => c.text)]
      .join(" ").toLocaleLowerCase("nb").includes(query))
    .sort((a, b) => stateOrder[taskState(a)] - stateOrder[taskState(b)] || byCreatedAt(a, b));

  el.taskList.replaceChildren();
  if (!tasks.length) {
    el.taskList.append(el.emptyTemplate.content.cloneNode(true));
    return;
  }
  tasks.forEach(task => el.taskList.append(createTaskCard(task)));
}

function createTaskCard(task) {
  const state = taskState(task);
  const card = document.createElement("article");
  card.className = `task-card state-${state}`;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "task-check";
  check.checked = task.done;
  check.addEventListener("change", () => {
    task.done = check.checked;
    touchTask(task, ["done"]);
    persist();
  });

  const open = document.createElement("button");
  open.type = "button";
  open.className = "task-open";
  open.addEventListener("click", () => openTask(task.id));

  const row = document.createElement("div");
  row.className = "task-heading-row";
  const title = document.createElement("strong");
  title.textContent = task.title;
  const badge = document.createElement("span");
  badge.className = `state-badge ${state}`;
  badge.textContent = stateText(state);
  row.append(title, badge);

  const condition = document.createElement("p");
  condition.className = "condition";
  if (state === "waiting") {
    condition.textContent = `Blir klar når: ${unresolvedDependencies(task).map(item => item.title).join(", ")}`;
  } else if (task.dependsOn.length) {
    condition.textContent = "Vilkårene er oppfylt";
  } else {
    condition.textContent = "Kan gjøres med en gang";
  }

  const meta = document.createElement("div");
  meta.className = "metadata";
  if (task.assignee) meta.append(chip(`Ansvarlig: ${task.assignee}`));
  task.labels.forEach(label => meta.append(chip(label)));
  if (task.comments.length) meta.append(chip(`${task.comments.length} kommentar${task.comments.length === 1 ? "" : "er"}`));

  open.append(row, condition, meta);
  card.append(check, open);
  return card;
}

function chip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

function byCreatedAt(a, b) {
  return a.createdAt.localeCompare(b.createdAt);
}

function openTask(id) {
  const task = taskById(id);
  if (!task || task.deleted) return;
  el.editTaskId.value = task.id;
  el.editTitle.value = task.title;
  el.editAssignee.value = task.assignee;
  el.editLabels.value = task.labels.join(", ");
  el.commentText.value = "";
  renderDialogParts(task);
  el.taskDialog.showModal();
}

function renderDialogParts(task) {
  const state = taskState(task);
  el.dialogState.textContent = stateText(state);
  el.dialogState.className = `state-label ${state}`;
  renderDependencies(task);
  renderComments(task);
}

function renderDependencies(task) {
  el.dependencyList.replaceChildren();
  const dependencies = task.dependsOn.map(taskById).filter(item => item && !item.deleted);
  if (!dependencies.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Kan gjøres med en gang";
    el.dependencyList.append(p);
  } else {
    dependencies.forEach(dependency => {
      const row = document.createElement("div");
      row.className = "dependency-row";
      const text = document.createElement("span");
      text.textContent = `${dependency.done ? "✓" : "○"} ${dependency.title}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Fjern";
      remove.addEventListener("click", () => {
        task.dependsOn = task.dependsOn.filter(id => id !== dependency.id);
        touchTask(task, ["dependsOn"]);
        persist();
      });
      row.append(text, remove);
      el.dependencyList.append(row);
    });
  }

  el.addDependencySelect.replaceChildren(new Option("Velg oppgave", ""));
  liveTasks()
    .filter(candidate => candidate.id !== task.id)
    .filter(candidate => !task.dependsOn.includes(candidate.id))
    .filter(candidate => !wouldCreateCycle(task.id, candidate.id))
    .sort(byCreatedAt)
    .forEach(candidate => el.addDependencySelect.add(new Option(candidate.title, candidate.id)));
  el.addDependencyButton.disabled = el.addDependencySelect.options.length <= 1;
}

function renderComments(task) {
  el.commentList.replaceChildren();
  if (!task.comments.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Ingen kommentarer ennå.";
    el.commentList.append(p);
    return;
  }
  task.comments.slice().sort(byCreatedAt).forEach(comment => {
    const article = document.createElement("article");
    article.className = "comment";
    const meta = document.createElement("div");
    meta.className = "comment-meta";
    const author = document.createElement("strong");
    author.textContent = comment.author || "Ukjent";
    const time = document.createElement("time");
    time.textContent = formatDate(comment.createdAt);
    const p = document.createElement("p");
    p.textContent = comment.text;
    meta.append(author, time);
    article.append(meta, p);
    el.commentList.append(article);
  });
}

function transportReady() {
  return Boolean(window.NEST_GITHUB_CONNECTED || window.NEST_LOCAL_CONNECTED);
}

function renderChat() {
  el.chatList.replaceChildren();
  if (!workspace.chat.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = transportReady()
      ? "Kanalen er stille. Fyr av første melding."
      : "Koble til en kanal for å snakke med kollegaene.";
    el.chatList.append(p);
    return;
  }
  workspace.chat.slice(-300).forEach(message => {
    const article = document.createElement("article");
    article.className = `chat-message${message.clientId === clientId ? " own" : ""}`;
    const meta = document.createElement("div");
    meta.className = "chat-meta";
    const author = document.createElement("strong");
    author.textContent = message.author || "Ukjent";
    const time = document.createElement("time");
    time.textContent = formatDate(message.createdAt);
    const p = document.createElement("p");
    p.textContent = message.text;
    meta.append(author, time);
    article.append(meta, p);
    el.chatList.append(article);
  });
  el.chatList.scrollTop = el.chatList.scrollHeight;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function parseLabels(value) {
  return [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
}

async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function prepareRoom(channel, password) {
  const hash = await sha256Bytes(`nest-room:${channel.trim().toLocaleLowerCase("nb")}`);
  roomId = bytesToHex(hash);
  const salt = (await sha256Bytes(`nest-key:${roomId}`)).slice(0, 16);
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  roomKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPayload(payload) {
  if (!roomKey) throw new Error("Kanalnøkkel er ikke klar.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(roomId) },
    roomKey,
    plain
  );
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptEnvelope(envelope) {
  if (!roomKey) throw new Error("Kanalnøkkel er ikke klar.");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.iv),
      additionalData: encoder.encode(roomId)
    },
    roomKey,
    base64ToBytes(envelope.data)
  );
  return JSON.parse(decoder.decode(plain));
}

function setConnectionState(state, text) {
  el.statusDot.className = `status-dot ${state}`;
  el.statusText.textContent = text;
}

el.taskForm.addEventListener("submit", event => {
  event.preventDefault();
  const title = el.taskTitle.value.trim();
  if (!title) return;
  const now = nowIso();
  const dependsOn = el.taskDependency.value ? [el.taskDependency.value] : [];
  const fieldUpdatedAt = Object.fromEntries(NESTCore.TASK_FIELDS.map(field => [field, now]));
  workspace.tasks.push({
    id: crypto.randomUUID(),
    title,
    assignee: el.taskAssignee.value.trim(),
    done: false,
    deleted: false,
    labels: [],
    dependsOn,
    comments: [],
    createdAt: now,
    updatedAt: now,
    fieldUpdatedAt
  });
  el.taskForm.reset();
  persist();
  el.taskTitle.focus();
});

el.filters.addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  currentFilter = button.dataset.filter;
  el.filters.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
  renderTasks();
});

el.searchInput.addEventListener("input", renderTasks);

el.chatForm.addEventListener("submit", event => {
  event.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text || !transportReady()) return;
  const message = {
    id: crypto.randomUUID(),
    author: connectedNickname || el.nickname.value.trim() || "Ukjent",
    text,
    createdAt: nowIso(),
    clientId
  };
  workspace.chat.push(message);
  workspace.chat = workspace.chat.slice(-300);
  el.chatInput.value = "";
  persist();
});

el.addDependencyButton.addEventListener("click", () => {
  const task = taskById(el.editTaskId.value);
  const dependencyId = el.addDependencySelect.value;
  if (!task || !dependencyId || wouldCreateCycle(task.id, dependencyId)) return;
  task.dependsOn = [...new Set([...task.dependsOn, dependencyId])];
  touchTask(task, ["dependsOn"]);
  persist();
});

el.addCommentButton.addEventListener("click", () => {
  const task = taskById(el.editTaskId.value);
  const text = el.commentText.value.trim();
  if (!task || !text) return;
  task.comments.push({
    id: crypto.randomUUID(),
    author: connectedNickname || el.nickname.value.trim() || task.assignee || "Ukjent",
    text,
    createdAt: nowIso()
  });
  touchTask(task);
  el.commentText.value = "";
  persist();
});

el.saveTaskButton.addEventListener("click", () => {
  const task = taskById(el.editTaskId.value);
  if (!task) return;
  const title = el.editTitle.value.trim();
  if (!title) return alert("Oppgaven må ha et navn.");
  const nextAssignee = el.editAssignee.value.trim();
  const nextLabels = parseLabels(el.editLabels.value);
  const changed = [];
  if (task.title !== title) changed.push("title");
  if (task.assignee !== nextAssignee) changed.push("assignee");
  if (JSON.stringify(task.labels) !== JSON.stringify(nextLabels)) changed.push("labels");
  task.title = title;
  task.assignee = nextAssignee;
  task.labels = nextLabels;
  if (changed.length) touchTask(task, changed);
  persist();
  el.taskDialog.close();
});

el.deleteTaskButton.addEventListener("click", () => {
  const task = taskById(el.editTaskId.value);
  if (!task || !confirm(`Slett «${task.title}»?`)) return;
  task.deleted = true;
  touchTask(task, ["deleted"]);
  persist();
  el.taskDialog.close();
});

loadSettings();
render();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}
