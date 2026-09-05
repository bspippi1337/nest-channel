(() => {
  "use strict";

  const UX_VERSION = "0.6.0";
  const MODE_KEY = "nest.sync.mode.v1";
  const WORKSPACE_KEY = "nest.channel.workspace.v1";
  const AUTO_LOCAL_SEND_MS = 220;

  const byId = id => document.getElementById(id);
  const shell = document.querySelector(".shell");
  const workspaceEl = document.querySelector(".workspace");
  const tasksPane = document.querySelector(".tasks-pane");
  const channelPane = document.querySelector(".channel-pane");
  const connectCard = document.querySelector(".connect-card");

  let autoLocalSendTimer = null;
  let autoLocalStarted = false;
  let activeMobilePane = "tasks";
  let unreadChat = 0;
  let lastChatCount = document.querySelectorAll("#chatList .chat-message").length;
  let autosaveTimer = null;

  function toast(message, { actionLabel = "", action = null, timeout = 5200 } = {}) {
    let host = document.getElementById("nestToastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "nestToastHost";
      host.className = "nest-toast-host";
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-atomic", "true");
      document.body.append(host);
    }

    const item = document.createElement("div");
    item.className = "nest-toast";
    const text = document.createElement("span");
    text.textContent = message;
    item.append(text);

    let timer = null;
    const remove = () => {
      if (timer) clearTimeout(timer);
      item.classList.add("leaving");
      setTimeout(() => item.remove(), 180);
    };

    if (actionLabel && typeof action === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = actionLabel;
      button.addEventListener("click", () => {
        try { action(); } finally { remove(); }
      });
      item.append(button);
    }

    host.append(item);
    requestAnimationFrame(() => item.classList.add("shown"));
    timer = setTimeout(remove, timeout);
    return item;
  }

  function getMode() {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === "local" || raw === "github" || raw === "auto" ? raw : "auto";
  }

  function setMode(next) {
    if (!["auto", "github", "local"].includes(next)) return;
    localStorage.setItem(MODE_KEY, next);
    try { window.NativeHost?.setSyncMode?.(next === "local" ? "local" : "github"); } catch {}
    location.reload();
  }

  function setupAutoModePicker() {
    const picker = document.querySelector(".sync-mode-picker");
    if (!picker || picker.querySelector('[data-mode="auto"]')) return;

    [...picker.querySelectorAll("button")].forEach(button => {
      if (/github/i.test(button.textContent)) button.dataset.mode = "github";
      if (/lokalt/i.test(button.textContent)) button.dataset.mode = "local";
    });

    const auto = document.createElement("button");
    auto.type = "button";
    auto.dataset.mode = "auto";
    auto.textContent = "Auto";
    auto.title = "Bruk lokal kryptert P2P når mulig, og GitHub som internettspor.";
    picker.prepend(auto);

    const current = getMode();
    [...picker.querySelectorAll("button")].forEach(button => {
      button.classList.toggle("active", button.dataset.mode === current);
    });

    picker.addEventListener("click", event => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      const next = button.dataset.mode;
      if (next === current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMode(next);
    }, true);
  }

  function mirrorSyncSummary() {
    const summaryState = byId("syncSummaryState");
    const summaryDetail = byId("syncSummaryDetail");
    const statusText = byId("statusText");
    const peerCount = byId("peerCount");
    if (!summaryState || !summaryDetail || !statusText || !peerCount) return;

    const apply = () => {
      const mode = getMode();
      const label = mode === "auto" ? "Auto" : mode === "local" ? "Lokalt" : "GitHub";
      summaryState.textContent = `${label} · ${statusText.textContent || "klar"}`;
      summaryDetail.textContent = peerCount.textContent || "Synkstatus";
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(statusText, { childList: true, subtree: true, characterData: true });
    observer.observe(peerCount, { childList: true, subtree: true, characterData: true });
  }

  function setupWorkspaceFirst() {
    if (!shell || !workspaceEl || !connectCard || byId("syncSettings")) return;

    const details = document.createElement("details");
    details.id = "syncSettings";
    details.className = "sync-settings";

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="sync-summary-main">
        <strong>Synk og sikkerhet</strong>
        <small id="syncSummaryState">Auto · klar</small>
      </span>
      <span id="syncSummaryDetail" class="sync-summary-detail">Synkstatus</span>
    `;

    const quick = document.createElement("div");
    quick.className = "sync-quick-actions";
    quick.innerHTML = `
      <button id="nestInviteButton" class="ghost" type="button">Inviter</button>
      <button id="nestJoinButton" class="ghost" type="button">Bli med med kode</button>
    `;

    details.append(summary, quick, connectCard);
    workspaceEl.insertAdjacentElement("afterend", details);
    mirrorSyncSummary();

    if (location.hash === "#sync") details.open = true;
  }

  function base64UrlEncode(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function getChannelPassword() {
    const visible = byId("channelPassword")?.value || "";
    if (visible) return visible;
    try { return String(window.NativeHost?.loadSecret?.("channel_password") || ""); }
    catch { return ""; }
  }

  function makeInviteCode() {
    const repo = byId("relayUrl")?.value.trim() || "bspippi1337/nest-channel";
    const channel = byId("channelName")?.value.trim().replace(/^#/, "") || "";
    const password = getChannelPassword();
    if (!channel || password.length < 8) {
      throw new Error("Koble til en GitHub-kanal først, eller fyll inn kanal og passord.");
    }
    return "NEST1." + base64UrlEncode(JSON.stringify({
      v: 1,
      repo,
      channel,
      password
    }));
  }

  async function shareInvite() {
    let code;
    try { code = makeInviteCode(); }
    catch (error) {
      toast(error.message || String(error));
      document.getElementById("syncSettings")?.setAttribute("open", "");
      return;
    }

    const text = `NEST Channel-invitasjon\n${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "NEST Channel", text });
        toast("Invitasjonen er klar. Del den privat; koden gir kanaltilgang.");
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }

    try {
      await navigator.clipboard.writeText(code);
      toast("Invitasjonskoden er kopiert. Del den privat; koden gir kanaltilgang.");
    } catch {
      window.prompt("Kopier NEST-koden. Del den privat:", code);
    }
  }

  function applyInviteCode(raw) {
    const match = String(raw || "").match(/NEST1\.[A-Za-z0-9_-]+/);
    if (!match) throw new Error("Fant ingen gyldig NEST1-invitasjonskode.");

    let payload;
    try { payload = JSON.parse(base64UrlDecode(match[0].slice(6))); }
    catch { throw new Error("Invitasjonskoden kunne ikke leses."); }

    if (payload?.v !== 1 || !payload.repo || !payload.channel || typeof payload.password !== "string") {
      throw new Error("Invitasjonskoden mangler kanaldata.");
    }

    if (byId("relayUrl")) byId("relayUrl").value = payload.repo;
    if (byId("channelName")) byId("channelName").value = payload.channel;
    if (byId("channelPassword")) byId("channelPassword").value = payload.password;
    try { window.NativeHost?.saveSecret?.("channel_password", payload.password); } catch {}

    try {
      const settings = JSON.parse(localStorage.getItem("nest.channel.settings.v1") || "{}");
      settings.relayUrl = payload.repo;
      settings.channelName = payload.channel;
      localStorage.setItem("nest.channel.settings.v1", JSON.stringify(settings));
    } catch {}

    localStorage.setItem(MODE_KEY, "auto");
    try { window.NativeHost?.setSyncMode?.("github"); } catch {}
    document.getElementById("syncSettings")?.setAttribute("open", "");
    byId("nickname")?.focus();
    toast("Kanaldata lagt inn. Skriv kallenavn og logg inn med GitHub hvis nødvendig.");
  }

  function setupInviteActions() {
    byId("nestInviteButton")?.addEventListener("click", shareInvite);
    byId("nestJoinButton")?.addEventListener("click", () => {
      const raw = window.prompt("Lim inn NEST-invitasjonskode:");
      if (!raw) return;
      try { applyInviteCode(raw); }
      catch (error) { toast(error.message || String(error)); }
    });
  }

  function autoLocalSend(delay = AUTO_LOCAL_SEND_MS) {
    if (!autoLocalStarted) return;
    clearTimeout(autoLocalSendTimer);
    autoLocalSendTimer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(WORKSPACE_KEY) ||
          JSON.stringify({ version: 2, tasks: [], chat: [], updatedAt: new Date().toISOString() });
        window.NativeLocal?.sendWorkspace?.(raw);
      } catch {}
    }, delay);
  }

  function setupAutoLocalTransport() {
    if (getMode() !== "auto" || !window.NativeLocal?.start) return;

    let peers = 0;
    window.NestLocalSync = {
      onStatus(state, count) {
        peers = Number(count) || 0;
        const summary = byId("syncSummaryDetail");
        if (summary && peers > 0) summary.textContent = `${peers + 1} telefoner lokalt · kryptert`;
      },
      onWorkspace(raw) {
        try {
          mergeWorkspace(JSON.parse(String(raw)));
          autoLocalSend(650);
        } catch {}
      },
      onError(message) {
        const summary = byId("syncSummaryDetail");
        if (summary && !window.NEST_GITHUB_CONNECTED) summary.textContent = String(message || "Lokal synk utilgjengelig");
      }
    };

    try {
      window.NativeLocal.start();
      autoLocalStarted = true;
      window.NEST_LOCAL_CONNECTED = true;
      connectedNickname = localStorage.getItem("nest.local.nickname.v1") ||
        byId("nickname")?.value.trim() ||
        `Telefon ${String(clientId).slice(0, 4).toUpperCase()}`;
      if (byId("chatInput")) byId("chatInput").disabled = false;
      const chatButton = byId("chatForm")?.querySelector("button");
      if (chatButton) chatButton.disabled = false;
      if (byId("channelHeading") && !window.NEST_GITHUB_CONNECTED) byId("channelHeading").textContent = "Auto · lokalt";
      if (byId("encryptedBadge") && !window.NEST_GITHUB_CONNECTED) byId("encryptedBadge").textContent = "🔒 AUTO";
      autoLocalSend(500);
    } catch {
      autoLocalStarted = false;
      window.NEST_LOCAL_CONNECTED = false;
    }

    window.addEventListener("nest:workspace-changed", () => autoLocalSend());
    window.addEventListener("beforeunload", () => {
      try { window.NativeLocal?.stop?.(); } catch {}
    });
  }

  function setupAutosave() {
    const fields = [byId("editTitle"), byId("editAssignee"), byId("editLabels")].filter(Boolean);
    const saveButton = byId("saveTaskButton");
    if (saveButton) saveButton.textContent = "Lukk";

    const save = () => {
      const task = taskById(byId("editTaskId")?.value);
      if (!task) return;
      const title = byId("editTitle")?.value.trim() || "";
      if (!title) return;

      const nextAssignee = byId("editAssignee")?.value.trim() || "";
      const nextLabels = parseLabels(byId("editLabels")?.value || "");
      const changed = [];

      if (task.title !== title) changed.push("title");
      if (task.assignee !== nextAssignee) changed.push("assignee");
      if (JSON.stringify(task.labels) !== JSON.stringify(nextLabels)) changed.push("labels");
      if (!changed.length) return;

      task.title = title;
      task.assignee = nextAssignee;
      task.labels = nextLabels;
      touchTask(task, changed);
      persist({ renderNow: false });
      const state = byId("dialogState");
      if (state) state.dataset.autosaved = "true";
    };

    fields.forEach(field => field.addEventListener("input", () => {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(save, 380);
    }));

    byId("taskDialog")?.addEventListener("close", () => {
      clearTimeout(autosaveTimer);
      save();
      render();
    });

    byId("addDependencySelect")?.addEventListener("change", () => {
      if (byId("addDependencySelect")?.value) byId("addDependencyButton")?.click();
    });

    byId("commentText")?.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      byId("addCommentButton")?.click();
    });
  }

  function readyIds() {
    try {
      return new Set(liveTasks().filter(task => taskState(task) === "ready").map(task => task.id));
    } catch {
      return new Set();
    }
  }

  function setupCompletionFeedback() {
    document.addEventListener("change", event => {
      const check = event.target.closest?.(".task-check");
      if (!check) return;

      const before = readyIds();
      const doneBefore = new Map(workspace.tasks.map(item => [item.id, Boolean(item.done)]));
      const completing = check.checked;
      if (!completing) return;

      setTimeout(() => {
        const after = liveTasks().filter(item => taskState(item) === "ready" && !before.has(item.id));
        const names = after.slice(0, 2).map(item => item.title);
        const suffix = after.length
          ? ` · ${after.length} ${after.length === 1 ? "ny oppgave ble klar" : "nye oppgaver ble klare"}${names.length ? `: ${names.join(", ")}${after.length > 2 ? " …" : ""}` : ""}`
          : "";

        const changedTask = workspace.tasks.find(item => !doneBefore.get(item.id) && item.done);
        toast(`Ferdig${suffix}`, {
          actionLabel: "Angre",
          action: () => {
            if (!changedTask) return;
            changedTask.done = false;
            touchTask(changedTask, ["done"]);
            persist();
          }
        });
      }, 0);
    }, true);
  }

  function directUnlocksFromDelete(task) {
    if (!task) return [];
    return liveTasks().filter(candidate => {
      if (candidate.id === task.id || candidate.done || !candidate.dependsOn.includes(task.id)) return false;
      if (taskState(candidate) !== "waiting") return false;
      return candidate.dependsOn.every(id => {
        if (id === task.id) return true;
        const prerequisite = taskById(id);
        return !prerequisite || prerequisite.deleted || prerequisite.done;
      });
    });
  }

  function setupSafeDelete() {
    const button = byId("deleteTaskButton");
    if (!button) return;

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const task = taskById(byId("editTaskId")?.value);
      if (!task) return;

      const unlocks = directUnlocksFromDelete(task);
      const detail = unlocks.length
        ? `\n\nDette vil gjøre ${unlocks.length} ${unlocks.length === 1 ? "oppgave" : "oppgaver"} klare:\n${unlocks.slice(0, 5).map(item => `• ${item.title}`).join("\n")}${unlocks.length > 5 ? "\n• …" : ""}`
        : "";

      if (!window.confirm(`Slett «${task.title}»?${detail}`)) return;

      task.deleted = true;
      touchTask(task, ["deleted"]);
      persist();
      byId("taskDialog")?.close();

      toast(`«${task.title}» slettet${unlocks.length ? ` · ${unlocks.length} nye oppgaver er nå klare` : ""}`, {
        actionLabel: "Angre",
        action: () => {
          task.deleted = false;
          touchTask(task, ["deleted"]);
          persist();
        },
        timeout: 7000
      });
    }, true);
  }

  function setMobilePane(next) {
    activeMobilePane = next === "channel" ? "channel" : "tasks";
    const nav = byId("mobileNav");
    if (!nav || !tasksPane || !channelPane) return;

    nav.querySelectorAll("button[data-pane]").forEach(button => {
      button.classList.toggle("active", button.dataset.pane === activeMobilePane);
      button.setAttribute("aria-selected", String(button.dataset.pane === activeMobilePane));
    });

    tasksPane.classList.toggle("mobile-pane-hidden", activeMobilePane !== "tasks");
    channelPane.classList.toggle("mobile-pane-hidden", activeMobilePane !== "channel");

    if (activeMobilePane === "channel") {
      unreadChat = 0;
      const badge = byId("mobileUnread");
      if (badge) {
        badge.textContent = "";
        badge.hidden = true;
      }
    }
  }

  function setupMobileNavigation() {
    if (!workspaceEl || !tasksPane || !channelPane || byId("mobileNav")) return;
    const nav = document.createElement("nav");
    nav.id = "mobileNav";
    nav.className = "mobile-nav";
    nav.setAttribute("aria-label", "NEST hovedvisning");
    nav.innerHTML = `
      <button type="button" class="active" data-pane="tasks" role="tab" aria-selected="true">Klar</button>
      <button type="button" data-pane="channel" role="tab" aria-selected="false">Kanal <b id="mobileUnread" hidden></b></button>
    `;
    workspaceEl.insertAdjacentElement("beforebegin", nav);

    nav.addEventListener("click", event => {
      const button = event.target.closest("button[data-pane]");
      if (button) setMobilePane(button.dataset.pane);
    });

    const media = matchMedia("(max-width: 900px)");
    const apply = () => {
      if (media.matches) setMobilePane(activeMobilePane);
      else {
        tasksPane.classList.remove("mobile-pane-hidden");
        channelPane.classList.remove("mobile-pane-hidden");
      }
    };
    media.addEventListener?.("change", apply);
    apply();

    const chat = byId("chatList");
    if (chat) {
      const observer = new MutationObserver(() => {
        const count = chat.querySelectorAll(".chat-message").length;
        if (count > lastChatCount && activeMobilePane !== "channel" && media.matches) {
          unreadChat += count - lastChatCount;
          const badge = byId("mobileUnread");
          if (badge) {
            badge.hidden = false;
            badge.textContent = unreadChat > 99 ? "99+" : String(unreadChat);
          }
        }
        lastChatCount = count;
      });
      observer.observe(chat, { childList: true });
    }
  }

  function setupBackBridge() {
    window.NESTBack = {
      handle() {
        const taskDialog = byId("taskDialog");
        const aboutDialog = byId("aboutDialog");
        const syncSettings = byId("syncSettings");

        if (taskDialog?.open) {
          taskDialog.close();
          return true;
        }
        if (aboutDialog?.open) {
          aboutDialog.close();
          return true;
        }
        if (matchMedia("(max-width: 900px)").matches && activeMobilePane === "channel") {
          setMobilePane("tasks");
          return true;
        }
        if (syncSettings?.open) {
          syncSettings.open = false;
          return true;
        }
        return false;
      }
    };
  }

  function stampVersion() {
    document.querySelectorAll(".about-footer span").forEach(node => {
      node.textContent = node.textContent.replace(/Versjon\s+\d+\.\d+\.\d+/, `Versjon ${UX_VERSION}`);
    });
  }

  setupWorkspaceFirst();
  setupAutoModePicker();
  setupInviteActions();
  setupAutoLocalTransport();
  setupAutosave();
  setupCompletionFeedback();
  setupSafeDelete();
  setupMobileNavigation();
  setupBackBridge();
  stampVersion();
})();