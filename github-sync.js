(() => {
  "use strict";

  const API = "https://api.github.com";
  const API_VERSION = "2022-11-28";
  const COMMENT_MARKER = "<!-- NEST-E2EE-V1 -->";
  const CLIENT_ID_KEY = "nest.github.client-id.v1";
  const ISSUE_KEY_PREFIX = "nest.github.issue.v1:";
  const MAX_CHUNK = 44000;
  const POLL_MS = 12000;
  const BACKOFF_START_MS = 3000;
  const BACKOFF_MAX_MS = 60000;
  const REQUEST_TIMEOUT_MS = 20000;
  const SNAPSHOT_PAGE_LIMIT = 10;

  const ui = {
    clientId: document.getElementById("githubClientId"),
    login: document.getElementById("githubLoginButton"),
    logout: document.getElementById("githubLogoutButton"),
    user: document.getElementById("githubUser"),
    setup: document.getElementById("oauthSetup"),
    devicePanel: document.getElementById("deviceFlowPanel"),
    deviceCode: document.getElementById("deviceUserCode"),
    deviceStatus: document.getElementById("deviceFlowStatus"),
    openDevice: document.getElementById("openDevicePageButton")
  };

  let token = "";
  let githubLogin = "";
  let issueNumber = 0;
  let repoOwner = "";
  let repoName = "";
  let pollTimer = null;
  let syncTimer = null;
  let lastPollAt = "";
  let lastSentDigest = "";
  let deviceFlow = null;
  let pollFailures = 0;
  let syncFailures = 0;
  const seenCommentIds = new Set();
  const chunkGroups = new Map();

  function nativeAvailable() {
    return typeof window.NativeHost === "object";
  }

  function secretLoad(key) {
    try { return nativeAvailable() ? String(window.NativeHost.loadSecret(key) || "") : ""; }
    catch { return ""; }
  }

  function secretSave(key, value) {
    try { if (nativeAvailable()) window.NativeHost.saveSecret(key, String(value)); }
    catch {}
  }

  function secretDelete(key) {
    try { if (nativeAvailable()) window.NativeHost.deleteSecret(key); }
    catch {}
  }

  function bundledClientId() {
    try { return nativeAvailable() ? String(window.NativeHost.getBundledGitHubClientId?.() || "") : ""; }
    catch { return ""; }
  }

  function authMode() {
    try { return nativeAvailable() ? String(window.NativeHost.getGitHubAuthMode?.() || "device") : "device"; }
    catch { return "device"; }
  }

  function resolveClientId() {
    return bundledClientId() || ui.clientId?.value.trim() || secretLoad("github_client_id") || localStorage.getItem(CLIENT_ID_KEY) || "";
  }

  function setAuthUi() {
    if (token && githubLogin) {
      ui.user.textContent = `@${githubLogin}`;
      ui.user.classList.add("online");
      ui.login.hidden = true;
      ui.logout.hidden = false;
      ui.setup.hidden = true;
    } else {
      ui.user.textContent = "Ikke innlogget";
      ui.user.classList.remove("online");
      ui.login.hidden = false;
      ui.logout.hidden = true;
      const bundled = Boolean(bundledClientId());
      ui.setup.hidden = bundled;
      if (bundled) ui.login.title = "Sikker GitHub Authorization Code + PKCE";
    }
  }

  function retryDelay(failures, serverDelay = 0) {
    const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * (2 ** Math.max(0, failures - 1)));
    const base = Math.max(exponential, Number(serverDelay) || 0);
    const jitter = Math.floor(Math.random() * Math.min(1500, Math.max(250, base * 0.2)));
    return Math.min(BACKOFF_MAX_MS, base + jitter);
  }

  function retryAfterFrom(response) {
    const header = response.headers.get("Retry-After");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
      const date = Date.parse(header);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
    const reset = Number(response.headers.get("X-RateLimit-Reset"));
    if (Number.isFinite(reset) && reset > 0 && (response.status === 403 || response.status === 429)) {
      return Math.max(0, reset * 1000 - Date.now());
    }
    return 0;
  }

  async function api(path, options = {}) {
    if (!token) throw new Error("Logg inn med GitHub først.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
          ...(options.headers || {})
        }
      });
    } catch (error) {
      const wrapped = new Error(error?.name === "AbortError" ? "GitHub svarte ikke innen 20 sekunder" : `Nettverksfeil: ${error?.message || error}`);
      wrapped.status = 0;
      throw wrapped;
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 304) return null;
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.message ? `: ${body.message}` : "";
      const error = new Error(`GitHub svarte ${response.status}${detail}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterFrom(response);
      throw error;
    }
    return body;
  }

  async function verifyToken() {
    if (!token) return false;
    try {
      const user = await api("/user");
      githubLogin = user.login || "GitHub-bruker";
      setAuthUi();
      return true;
    } catch (error) {
      if (error?.status === 401) {
        token = "";
        githubLogin = "";
        secretDelete("github_token");
        setAuthUi();
      } else {
        setConnectionState("connecting", `GitHub midlertidig utilgjengelig · ${error.message}`);
      }
      return false;
    }
  }

  function beginDeviceLogin(clientId) {
    if (!nativeAvailable() || typeof window.NativeHost.requestGitHubDeviceCode !== "function") {
      alert("GitHub-innlogging krever Android-APK-en.");
      return;
    }
    if (!clientId) return alert("Lim inn OAuth-appens Client ID først.");
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    secretSave("github_client_id", clientId);
    ui.login.disabled = true;
    ui.login.textContent = "Starter GitHub …";
    window.NativeHost.requestGitHubDeviceCode(clientId);
  }

  function beginLogin() {
    if (!nativeAvailable()) return alert("GitHub-innlogging krever Android-APK-en.");
    ui.login.disabled = true;
    ui.login.textContent = "Starter GitHub …";
    if (authMode() === "pkce" && typeof window.NativeHost.startGitHubPkce === "function") {
      try {
        window.NativeHost.startGitHubPkce();
        return;
      } catch (error) {
        ui.login.disabled = false;
        ui.login.textContent = "Logg inn med GitHub";
        alert(`Kunne ikke starte PKCE: ${error?.message || error}`);
        return;
      }
    }
    ui.login.disabled = false;
    ui.login.textContent = "Logg inn med GitHub";
    beginDeviceLogin(resolveClientId());
  }

  function scheduleTokenPoll(delaySeconds) {
    clearTimeout(deviceFlow?.timer);
    if (!deviceFlow) return;
    deviceFlow.timer = setTimeout(() => {
      window.NativeHost.pollGitHubDeviceToken(deviceFlow.clientId, deviceFlow.deviceCode);
    }, Math.max(5, delaySeconds) * 1000);
  }

  async function acceptTokenResponse(raw) {
    let response;
    try { response = JSON.parse(raw); } catch { response = { error: "Ugyldig svar" }; }
    if (!response.access_token) throw new Error(response.error_description || response.error || "GitHub returnerte ikke access token");
    token = response.access_token;
    secretSave("github_token", token);
    ui.devicePanel.hidden = true;
    await verifyToken();
    maybeAutoConnect();
  }

  window.NestGitHubAuth = {
    onPkceStarted() {
      ui.login.disabled = true;
      ui.login.textContent = "Venter på GitHub …";
    },
    async onPkceToken(raw) {
      ui.login.disabled = false;
      ui.login.textContent = "Logg inn med GitHub";
      try { await acceptTokenResponse(raw); }
      catch (error) { alert(`GitHub-innlogging feilet: ${error.message}`); }
    },
    onDeviceCode(raw) {
      ui.login.disabled = false;
      ui.login.textContent = "Logg inn med GitHub";
      let response;
      try { response = JSON.parse(raw); } catch { response = { error: "Ugyldig svar" }; }
      if (response.error || !response.device_code) {
        alert(`GitHub-innlogging feilet: ${response.error_description || response.error || "ukjent feil"}`);
        return;
      }
      deviceFlow = {
        clientId: resolveClientId(),
        deviceCode: response.device_code,
        userCode: response.user_code,
        verificationUri: response.verification_uri || "https://github.com/login/device",
        interval: Number(response.interval) || 5,
        expiresAt: Date.now() + (Number(response.expires_in) || 900) * 1000,
        timer: null
      };
      ui.deviceCode.textContent = deviceFlow.userCode;
      ui.deviceStatus.textContent = "Godkjenn NEST Channel i GitHub. Appen kobler til automatisk etterpå.";
      ui.devicePanel.hidden = false;
      try { window.NativeHost.openExternalUrl(deviceFlow.verificationUri); } catch {}
      scheduleTokenPoll(deviceFlow.interval);
    },
    async onDeviceToken(raw) {
      if (!deviceFlow) return;
      let response;
      try { response = JSON.parse(raw); } catch { response = { error: "Ugyldig svar" }; }
      if (response.access_token) {
        clearTimeout(deviceFlow.timer);
        deviceFlow = null;
        try { await acceptTokenResponse(raw); }
        catch (error) { alert(`GitHub-innlogging feilet: ${error.message}`); }
        return;
      }
      if (Date.now() >= deviceFlow.expiresAt || response.error === "expired_token") {
        ui.deviceStatus.textContent = "Koden utløp. Start innlogging på nytt.";
        deviceFlow = null;
        return;
      }
      if (response.error === "slow_down") deviceFlow.interval += 5;
      if (response.error && !["authorization_pending", "slow_down"].includes(response.error)) {
        ui.deviceStatus.textContent = response.error_description || response.error;
        return;
      }
      scheduleTokenPoll(deviceFlow.interval);
    },
    onNativeError(message) {
      ui.login.disabled = false;
      ui.login.textContent = "Logg inn med GitHub";
      ui.deviceStatus.textContent = String(message || "Nettverksfeil");
    }
  };

  function parseRepo(value) {
    const clean = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
    const [owner, repo, ...rest] = clean.split("/");
    if (!owner || !repo || rest.length) throw new Error("Repo må skrives som eier/repo.");
    return { owner, repo };
  }

  function roomMarker() { return `<!-- NEST-ROOM:${roomId} -->`; }

  async function findOrCreateIssue() {
    const cacheKey = `${ISSUE_KEY_PREFIX}${repoOwner}/${repoName}:${roomId}`;
    const cached = Number(localStorage.getItem(cacheKey));
    if (cached) {
      try {
        const issue = await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues/${cached}`);
        if (issue?.state === "open" && String(issue.body || "").includes(roomMarker())) return cached;
      } catch {}
    }
    const issues = await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues?state=open&per_page=100&sort=updated&direction=desc`);
    const found = issues.find(issue => !issue.pull_request && String(issue.body || "").includes(roomMarker()));
    if (found) {
      localStorage.setItem(cacheKey, String(found.number));
      return found.number;
    }
    const created = await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `[NEST SYNC] ${roomId.slice(0, 12)}`, body: `${roomMarker()}\n\nKryptert NEST Channel-synk. Innholdet kan bare åpnes med kanalpassordet i appen.` })
    });
    localStorage.setItem(cacheKey, String(created.number));
    return created.number;
  }

  function parseEncryptedComment(body) {
    if (typeof body !== "string" || !body.startsWith(COMMENT_MARKER)) return null;
    try {
      const item = JSON.parse(body.slice(COMMENT_MARKER.length).trim());
      if (![1, 2].includes(Number(item.v)) || item.room !== roomId || !item.id || !item.data || !item.iv) return null;
      return item;
    } catch { return null; }
  }

  function commentChunk(comment) {
    const chunk = parseEncryptedComment(comment?.body);
    if (!chunk) return null;
    return { ...chunk, commentId: comment.id, createdAt: String(comment.created_at || comment.updated_at || "") };
  }

  async function receiveCompleteEnvelope(group) {
    try {
      const payload = await decryptEnvelope({ id: group.id, iv: group.iv, data: group.data });
      if (payload.kind !== "workspace") return false;
      mergeWorkspace(payload.workspace);
      for (const id of group.commentIds || []) seenCommentIds.add(id);
      return true;
    } catch { return false; }
  }

  async function receiveComment(comment) {
    if (!comment?.id || seenCommentIds.has(comment.id)) return;
    seenCommentIds.add(comment.id);
    const chunk = parseEncryptedComment(comment.body);
    if (!chunk) return;
    const group = chunkGroups.get(chunk.id) || { total: Number(chunk.total) || 1, iv: chunk.iv, parts: [], received: 0 };
    const index = Math.max(0, Number(chunk.part || 1) - 1);
    if (group.total !== (Number(chunk.total) || 1) || group.iv !== chunk.iv) {
      chunkGroups.delete(chunk.id);
      return;
    }
    if (group.parts[index] === undefined) {
      group.parts[index] = chunk.data;
      group.received++;
    }
    chunkGroups.set(chunk.id, group);
    if (group.received < group.total) return;
    chunkGroups.delete(chunk.id);
    try {
      const payload = await decryptEnvelope({ id: chunk.id, iv: group.iv, data: group.parts.join("") });
      if (payload.kind === "workspace") mergeWorkspace(payload.workspace);
    } catch {
      setConnectionState("online", "GitHub tilkoblet · feil kanalpassord på en pakke");
    }
  }

  async function fetchLatestSnapshot() {
    const issue = await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues/${issueNumber}`);
    const commentCount = Math.max(0, Number(issue?.comments) || 0);
    if (!commentCount) {
      lastPollAt = new Date(Date.now() - 1000).toISOString();
      return false;
    }
    const chunks = [];
    let newestSeenAt = "";
    let page = Math.max(1, Math.ceil(commentCount / 100));
    let pagesRead = 0;
    while (page >= 1 && pagesRead < SNAPSHOT_PAGE_LIMIT) {
      const comments = await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
      pagesRead++;
      for (const comment of comments) {
        seenCommentIds.add(comment.id);
        const stamp = String(comment.created_at || comment.updated_at || "");
        if (stamp > newestSeenAt) newestSeenAt = stamp;
        const chunk = commentChunk(comment);
        if (chunk) chunks.push(chunk);
      }
      const groups = window.NESTCore.completeEnvelopeGroups(chunks);
      for (const group of groups) {
        if (await receiveCompleteEnvelope(group)) {
          const anchor = newestSeenAt ? Date.parse(newestSeenAt) : Date.now();
          lastPollAt = new Date((Number.isFinite(anchor) ? anchor : Date.now()) - 1000).toISOString();
          return true;
        }
      }
      page--;
    }
    throw new Error(`Kanalhistorikk finnes (${commentCount} kommentarer), men ingen komplett dekrypterbar snapshot ble funnet i de siste ${pagesRead * 100}. Kontroller kanalpassordet eller reparer synkhistorikken før du publiserer.`);
  }

  async function pollComments() {
    if (!window.NEST_GITHUB_CONNECTED) return;
    let delay = POLL_MS;
    try {
      const since = lastPollAt ? `&since=${encodeURIComponent(lastPollAt)}` : "";
      const comments = await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues/${issueNumber}/comments?per_page=100${since}`);
      let newest = lastPollAt;
      for (const comment of comments) {
        const stamp = String(comment.created_at || comment.updated_at || "");
        if (stamp > newest) newest = stamp;
        await receiveComment(comment);
      }
      const anchor = newest ? Date.parse(newest) : Date.now();
      lastPollAt = new Date((Number.isFinite(anchor) ? anchor : Date.now()) - 1000).toISOString();
      pollFailures = 0;
      setConnectionState("online", "GitHub-synk aktiv");
    } catch (error) {
      pollFailures++;
      delay = retryDelay(pollFailures, error?.retryAfterMs);
      setConnectionState("connecting", `Synk prøver igjen om ${Math.ceil(delay / 1000)}s · ${error.message}`);
    } finally {
      clearTimeout(pollTimer);
      if (window.NEST_GITHUB_CONNECTED) pollTimer = setTimeout(pollComments, delay);
    }
  }

  async function digestWorkspace() {
    const bytes = await sha256Bytes(JSON.stringify(workspace));
    return bytesToHex(bytes);
  }

  async function publishWorkspace({ force = false } = {}) {
    if (!window.NEST_GITHUB_CONNECTED) return;
    const digest = await digestWorkspace();
    if (!force && digest === lastSentDigest) return;
    const encrypted = await encryptPayload({ kind: "workspace", workspace });
    const total = Math.max(1, Math.ceil(encrypted.data.length / MAX_CHUNK));
    const envelopeId = crypto.randomUUID();
    for (let index = 0; index < total; index++) {
      const body = COMMENT_MARKER + "\n" + JSON.stringify({
        v: 2, kind: "snapshot", room: roomId, id: envelopeId, part: index + 1, total,
        iv: encrypted.iv, data: encrypted.data.slice(index * MAX_CHUNK, (index + 1) * MAX_CHUNK),
        sentAt: new Date().toISOString(), clientId
      });
      await api(`/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues/${issueNumber}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
    }
    lastSentDigest = digest;
    syncFailures = 0;
    el.peerCount.textContent = "GitHub oppdatert";
  }

  async function attemptPublish() {
    if (!window.NEST_GITHUB_CONNECTED) return;
    try {
      await publishWorkspace();
      setConnectionState("online", "GitHub-synk aktiv");
    } catch (error) {
      syncFailures++;
      const delay = retryDelay(syncFailures, error?.retryAfterMs);
      setConnectionState("connecting", `Venter på GitHub · nytt forsøk om ${Math.ceil(delay / 1000)}s`);
      clearTimeout(syncTimer);
      if (window.NEST_GITHUB_CONNECTED) syncTimer = setTimeout(attemptPublish, delay);
    }
  }

  function queuePublish() {
    if (!window.NEST_GITHUB_CONNECTED) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(attemptPublish, 1800);
  }

  async function connectGithub() {
    if (!token && !(await verifyToken())) return alert("Logg inn med GitHub først.");
    const channel = el.channelName.value.trim().replace(/^#/, "");
    const nickname = el.nickname.value.trim();
    const password = el.channelPassword.value || secretLoad("channel_password");
    if (!channel) return alert("Skriv et kanalnavn.");
    if (!nickname) return alert("Skriv et kallenavn.");
    if (password.length < 8) return alert("Kanalpassordet må ha minst 8 tegn.");
    let parsed;
    try { parsed = parseRepo(el.relayUrl.value || "bspippi1337/nest-channel"); }
    catch (error) { return alert(error.message); }
    repoOwner = parsed.owner;
    repoName = parsed.repo;
    connectedNickname = nickname;
    saveSettings();
    secretSave("channel_password", password);
    el.channelPassword.value = password;
    el.connectButton.disabled = true;
    setConnectionState("connecting", "Finner kryptert GitHub-kanal …");
    try {
      await prepareRoom(channel, password);
      issueNumber = await findOrCreateIssue();
      window.NEST_GITHUB_CONNECTED = true;
      pollFailures = 0;
      syncFailures = 0;
      el.disconnectButton.disabled = false;
      el.chatInput.disabled = false;
      el.chatForm.querySelector("button").disabled = false;
      el.channelHeading.textContent = `#${channel}`;
      el.peerCount.textContent = `GitHub #${issueNumber}`;
      const bootstrapped = await fetchLatestSnapshot();
      await publishWorkspace({ force: true });
      setConnectionState("online", bootstrapped ? "GitHub-synk aktiv · siste snapshot lastet" : "GitHub-synk aktiv · ny kanal");
      pollComments();
    } catch (error) {
      window.NEST_GITHUB_CONNECTED = false;
      el.connectButton.disabled = false;
      el.disconnectButton.disabled = true;
      setConnectionState("offline", `Kunne ikke koble til: ${error.message}`);
    }
  }

  function disconnectGithub() {
    window.NEST_GITHUB_CONNECTED = false;
    clearTimeout(pollTimer);
    clearTimeout(syncTimer);
    pollTimer = null;
    syncTimer = null;
    pollFailures = 0;
    syncFailures = 0;
    issueNumber = 0;
    roomId = "";
    roomKey = null;
    el.connectButton.disabled = false;
    el.disconnectButton.disabled = true;
    el.chatInput.disabled = true;
    el.chatForm.querySelector("button").disabled = true;
    el.channelHeading.textContent = "Ikke tilkoblet";
    el.peerCount.textContent = "GitHub frakoblet";
    setConnectionState("offline", "Frakoblet");
  }

  async function maybeAutoConnect() {
    if (!token || window.NEST_GITHUB_CONNECTED) return;
    const savedPassword = secretLoad("channel_password");
    if (savedPassword && el.channelName.value.trim() && el.nickname.value.trim()) {
      el.channelPassword.value = savedPassword;
      await connectGithub();
    }
  }

  ui.login.addEventListener("click", beginLogin);
  ui.logout.addEventListener("click", () => {
    disconnectGithub();
    token = "";
    githubLogin = "";
    secretDelete("github_token");
    setAuthUi();
  });
  ui.openDevice.addEventListener("click", () => {
    if (!deviceFlow) return;
    try { window.NativeHost.openExternalUrl(deviceFlow.verificationUri); }
    catch { window.open(deviceFlow.verificationUri, "_blank"); }
  });
  el.connectButton.addEventListener("click", connectGithub);
  el.disconnectButton.addEventListener("click", disconnectGithub);
  window.addEventListener("nest:workspace-changed", queuePublish);

  const storedClientId = bundledClientId() || secretLoad("github_client_id") || localStorage.getItem(CLIENT_ID_KEY) || "";
  ui.clientId.value = storedClientId;
  token = secretLoad("github_token");
  if (!el.relayUrl.value.trim()) el.relayUrl.value = "bspippi1337/nest-channel";
  setAuthUi();
  verifyToken().then(maybeAutoConnect);

  function loadSecurityV07() {
    if (!document.querySelector('link[href="security-v07.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "security-v07.css";
      document.head.append(link);
    }
    if (!document.querySelector('script[src="security-v07.js"]')) {
      const script = document.createElement("script");
      script.src = "security-v07.js";
      document.head.append(script);
    }
  }
  loadSecurityV07();
})();
