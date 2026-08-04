(() => {
  "use strict";

  const MODE_KEY = "nest.sync.mode.v1";
  const WORKSPACE_KEY = "nest.channel.workspace.v1";
  const mode = localStorage.getItem(MODE_KEY) === "local" ? "local" : "github";

  const dialog = document.getElementById("aboutDialog");
  const openButton = document.getElementById("aboutButton");
  const closeButton = document.getElementById("closeAboutButton");
  const startButton = document.getElementById("aboutStartButton");

  if (dialog && openButton && closeButton && startButton) {
    const open = () => { if (!dialog.open) dialog.showModal(); };
    const close = () => { if (dialog.open) dialog.close(); };
    openButton.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    startButton.addEventListener("click", () => {
      close();
      document.querySelector('[data-filter="ready"]')?.click();
      document.querySelector(".tasks-pane")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    dialog.addEventListener("click", event => {
      const bounds = dialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) close();
    });
  }

  const card = document.querySelector(".github-connect-card");
  if (!card) return;

  const css = document.createElement("style");
  css.textContent = `
    .sync-mode-picker{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;padding:.35rem;margin-bottom:1rem;border:1px solid var(--line);border-radius:16px;background:rgba(4,12,8,.7)}
    .sync-mode-picker button{min-height:46px;border:0;border-radius:12px;background:transparent;color:var(--muted);font-weight:800;letter-spacing:.01em}
    .sync-mode-picker button.active{background:var(--green);color:#041008;box-shadow:0 10px 28px rgba(93,240,166,.16)}
    .sync-panel[hidden]{display:none!important}
    .local-mode-panel{display:grid;gap:1rem}
    .local-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;align-items:center}
    .local-orbit{width:74px;height:74px;border:1px solid rgba(105,239,171,.45);border-radius:50%;display:grid;place-items:center;position:relative;color:var(--green);font-weight:900}
    .local-orbit:before,.local-orbit:after{content:"";position:absolute;border:1px solid rgba(105,239,171,.18);border-radius:50%}.local-orbit:before{inset:8px}.local-orbit:after{inset:18px}
    .local-status-box{display:grid;grid-template-columns:auto 1fr;gap:.8rem;align-items:center;padding:1rem;border:1px solid var(--line);border-radius:16px;background:rgba(3,11,7,.58)}
    .local-pulse{width:13px;height:13px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(93,240,166,.45);animation:nestPulse 2s infinite}
    .local-pulse.searching{background:#d8b55b}.local-pulse.offline{background:#637269;animation:none}
    .local-status-box strong,.local-status-box small{display:block}.local-status-box small{margin-top:.2rem;color:var(--muted)}
    .local-actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.local-actions .hint{flex:1 1 260px}
    @keyframes nestPulse{70%{box-shadow:0 0 0 13px rgba(93,240,166,0)}100%{box-shadow:0 0 0 0 rgba(93,240,166,0)}}
    @media(max-width:560px){.local-hero{grid-template-columns:1fr}.local-orbit{display:none}.sync-mode-picker{margin-bottom:.8rem}}
  `;
  document.head.append(css);

  const originalChildren = [...card.children];
  const picker = document.createElement("div");
  picker.className = "sync-mode-picker";
  picker.setAttribute("role", "tablist");
  picker.setAttribute("aria-label", "Velg synkmetode");

  const githubMode = document.createElement("button");
  githubMode.type = "button";
  githubMode.textContent = "Via GitHub";
  githubMode.classList.toggle("active", mode === "github");

  const localMode = document.createElement("button");
  localMode.type = "button";
  localMode.textContent = "Lokalt · null oppsett";
  localMode.classList.toggle("active", mode === "local");
  picker.append(githubMode, localMode);

  const githubPanel = document.createElement("div");
  githubPanel.className = "sync-panel github-mode-panel";
  githubPanel.hidden = mode !== "github";
  originalChildren.forEach(child => githubPanel.append(child));

  const localPanel = document.createElement("div");
  localPanel.className = "sync-panel local-mode-panel";
  localPanel.hidden = mode !== "local";
  localPanel.innerHTML = `
    <div class="local-hero">
      <div>
        <p class="eyebrow">LOKAL SYNK · UTEN GITHUB</p>
        <h2>Åpne appen. Telefonene finner hverandre.</h2>
        <p class="mode-description">Ingen konto, kanal, passord, IP-adresse eller vert/klient-valg. Oppgaver synkroniseres direkte på samme Wi-Fi eller hotspot.</p>
      </div>
      <div class="local-orbit" aria-hidden="true">P2P</div>
    </div>
    <div class="local-status-box">
      <span id="localPulse" class="local-pulse searching"></span>
      <div><strong id="localStatus">Starter lokal synk …</strong><small id="localPeers">Søker etter andre NEST-telefoner</small></div>
    </div>
    <div class="local-actions">
      <button id="restartLocalSync" class="primary" type="button">Søk på nytt</button>
      <span class="hint">Data forlater ikke lokalnettet. Lokalmodus er laget for rask basisbruk og krever at appen er åpen for kontinuerlig synk.</span>
    </div>
  `;

  card.replaceChildren(picker, githubPanel, localPanel);

  function persistNativeMode(next) {
    try { window.NativeHost?.setSyncMode?.(next); } catch {}
  }

  function switchMode(next) {
    if (next === mode) return;
    localStorage.setItem(MODE_KEY, next);
    persistNativeMode(next);
    if (next === "local") document.getElementById("disconnectButton")?.click();
    location.reload();
  }

  githubMode.addEventListener("click", () => switchMode("github"));
  localMode.addEventListener("click", () => switchMode("local"));
  persistNativeMode(mode);

  if (mode !== "local") return;

  const statusText = document.getElementById("statusText");
  const statusDot = document.getElementById("statusDot");
  const peerCount = document.getElementById("peerCount");
  const channelHeading = document.getElementById("channelHeading");
  const encryptedBadge = document.getElementById("encryptedBadge");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatButton = chatForm?.querySelector("button");
  const localStatus = document.getElementById("localStatus");
  const localPeers = document.getElementById("localPeers");
  const localPulse = document.getElementById("localPulse");
  const restart = document.getElementById("restartLocalSync");
  let sendTimer = null;
  let started = false;

  function setLocalUi(state, peers = 0, detail = "") {
    const active = state === "active";
    const searching = state === "searching";
    statusText.textContent = active ? "Lokal synk aktiv" : searching ? "Søker lokalt" : "Lokal synk stoppet";
    statusDot.className = `status-dot ${active ? "online" : searching ? "connecting" : "offline"}`;
    peerCount.textContent = peers > 0 ? `${peers + 1} telefoner lokalt` : "Bare denne telefonen";
    localStatus.textContent = active ? "Lokal synk er aktiv" : searching ? "Søker etter telefoner …" : "Lokal synk er stoppet";
    localPeers.textContent = detail || (peers > 0 ? `${peers} annen${peers === 1 ? "" : "e"} NEST-telefon${peers === 1 ? "" : "er"} funnet` : "Oppgaver lagres lokalt mens appen søker");
    localPulse.className = `local-pulse ${active ? "" : searching ? "searching" : "offline"}`.trim();
  }

  function queueWorkspaceSend(delay = 220) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(WORKSPACE_KEY) || JSON.stringify({ version: 1, tasks: [], chat: [], updatedAt: new Date().toISOString() });
        window.NativeLocal?.sendWorkspace?.(raw);
      } catch (error) {
        setLocalUi("offline", 0, String(error?.message || error));
      }
    }, delay);
  }

  window.NestLocalSync = {
    onStatus(state, peers, detail) {
      setLocalUi(String(state || "searching"), Number(peers) || 0, String(detail || ""));
    },
    onWorkspace(raw) {
      try {
        const remote = JSON.parse(String(raw));
        mergeWorkspace(remote);
        queueWorkspaceSend(650);
      } catch (error) {
        setLocalUi("searching", 0, `Ignorerte ugyldig lokal pakke: ${error?.message || error}`);
      }
    },
    onError(message) {
      setLocalUi("offline", 0, String(message || "Ukjent lokal nettverksfeil"));
    }
  };

  function startLocal() {
    try {
      if (!window.NativeLocal?.start) throw new Error("Lokal synk krever Android-APK-en.");
      connectedNickname = localStorage.getItem("nest.local.nickname.v1") || `Telefon ${String(clientId).slice(0, 4).toUpperCase()}`;
      socket = { readyState: WebSocket.OPEN };
      window.NEST_LOCAL_CONNECTED = true;
      chatInput.disabled = false;
      if (chatButton) chatButton.disabled = false;
      channelHeading.textContent = "Lokalt nettverk";
      encryptedBadge.textContent = "⌁ P2P";
      encryptedBadge.title = "Direkte lokal synk. Ingen GitHub eller skytjeneste.";
      setLocalUi("searching", 0);
      window.NativeLocal.start();
      started = true;
      queueWorkspaceSend(700);
    } catch (error) {
      setLocalUi("offline", 0, String(error?.message || error));
    }
  }

  function stopLocal() {
    try { window.NativeLocal?.stop?.(); } catch {}
    started = false;
    window.NEST_LOCAL_CONNECTED = false;
    socket = null;
    setLocalUi("offline", 0);
  }

  window.addEventListener("nest:workspace-changed", () => {
    if (started) queueWorkspaceSend();
  });

  chatForm?.addEventListener("submit", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = chatInput.value.trim();
    if (!text) return;
    workspace.chat.push({
      id: crypto.randomUUID(),
      author: connectedNickname,
      text,
      createdAt: new Date().toISOString(),
      clientId
    });
    chatInput.value = "";
    persist();
  }, true);

  restart?.addEventListener("click", () => {
    stopLocal();
    setTimeout(startLocal, 180);
  });

  window.addEventListener("beforeunload", () => {
    try { window.NativeLocal?.stop?.(); } catch {}
  });

  startLocal();
})();
