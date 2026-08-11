(() => {
  "use strict";

  const MODE_KEY = "nest.sync.mode.v1";
  const WORKSPACE_KEY = "nest.channel.workspace.v1";
  const MANUAL_PEER_KEY = "nest.local.manual-peer.v1";
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
    .sync-panel[hidden]{display:none!important}.local-mode-panel{display:grid;gap:1rem}
    .local-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;align-items:center}
    .local-orbit{width:78px;height:78px;border:1px solid rgba(105,239,171,.45);border-radius:50%;display:grid;place-items:center;position:relative;color:var(--green);font-weight:900;font-size:.74rem;text-align:center;line-height:1.2}
    .local-orbit:before,.local-orbit:after{content:"";position:absolute;border:1px solid rgba(105,239,171,.18);border-radius:50%}.local-orbit:before{inset:8px}.local-orbit:after{inset:18px}
    .local-status-box{display:grid;grid-template-columns:auto 1fr;gap:.8rem;align-items:center;padding:1rem;border:1px solid var(--line);border-radius:16px;background:rgba(3,11,7,.58)}
    .local-pulse{width:13px;height:13px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(93,240,166,.45);animation:nestPulse 2s infinite}.local-pulse.searching{background:#d8b55b}.local-pulse.offline{background:#637269;animation:none}
    .local-status-box strong,.local-status-box small{display:block}.local-status-box small{margin-top:.2rem;color:var(--muted)}
    .local-security{display:flex;gap:.5rem;flex-wrap:wrap}.local-security span{font-size:.72rem;border:1px solid rgba(105,240,174,.3);color:var(--green);border-radius:999px;padding:.3rem .55rem;background:rgba(105,240,174,.06)}
    .local-actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.local-actions .hint{flex:1 1 260px}
    .manual-peer{border-top:1px solid var(--line);padding-top:1rem;display:grid;gap:.7rem}.manual-peer summary{cursor:pointer;color:#c7d4cc;font-weight:750}.manual-peer-grid{display:grid;grid-template-columns:1fr auto;gap:.55rem}.manual-peer-meta{color:var(--muted);font-size:.76rem;line-height:1.5}.manual-peer code{color:#d9f7e7}
    @keyframes nestPulse{70%{box-shadow:0 0 0 13px rgba(93,240,166,0)}100%{box-shadow:0 0 0 0 rgba(93,240,166,0)}}
    @media(max-width:560px){.local-hero{grid-template-columns:1fr}.local-orbit{display:none}.sync-mode-picker{margin-bottom:.8rem}.manual-peer-grid{grid-template-columns:1fr}.manual-peer-grid button{width:100%}}
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
  localMode.textContent = "Lokalt · sikker P2P";
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
        <p class="eyebrow">LOKAL SYNK · SIKKER P2P</p>
        <h2>Åpne appen. Telefonene finner hverandre.</h2>
        <p class="mode-description">Null oppsett er fortsatt standard. Telefonene gjør en automatisk ECDH-håndhilsen og krypterer arbeidsdata parvis med AES-256-GCM på samme Wi-Fi eller hotspot.</p>
      </div>
      <div class="local-orbit" aria-hidden="true">AES<br>256</div>
    </div>
    <div class="local-security"><span>ECDH P-256</span><span>AES-256-GCM</span><span>Ingen sky</span></div>
    <div class="local-status-box">
      <span id="localPulse" class="local-pulse searching"></span>
      <div><strong id="localStatus">Starter sikker lokal synk …</strong><small id="localPeers">Søker etter andre NEST-telefoner</small></div>
    </div>
    <div class="local-actions">
      <button id="restartLocalSync" class="primary" type="button">Søk på nytt</button>
      <span class="hint">Oppgavedata sendes ikke i klartekst. Discovery-metadata er synlig på lokalnettet, mens arbeidsinnholdet krypteres parvis.</span>
    </div>
    <details class="manual-peer">
      <summary>Avansert fallback · koble til IP manuelt</summary>
      <p class="manual-peer-meta">Bruk dette bare hvis gjestenett eller bedriftsnett blokkerer multicast. Din adresse: <code id="localOwnIp">ukjent</code></p>
      <div class="manual-peer-grid">
        <input id="manualPeerIp" inputmode="decimal" autocomplete="off" placeholder="192.168.1.42" aria-label="IP-adresse til annen NEST-telefon">
        <button id="addManualPeer" class="ghost" type="button">Koble sikkert</button>
      </div>
      <p id="manualPeerHint" class="manual-peer-meta">Den andre telefonen må ha NEST Channel åpen i lokalmodus.</p>
    </details>
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
  const chatInput = document.getElementById("chatInput");
  const chatButton = document.getElementById("chatForm")?.querySelector("button");
  const localStatus = document.getElementById("localStatus");
  const localPeers = document.getElementById("localPeers");
  const localPulse = document.getElementById("localPulse");
  const restart = document.getElementById("restartLocalSync");
  const manualPeerIp = document.getElementById("manualPeerIp");
  const addManualPeer = document.getElementById("addManualPeer");
  const manualPeerHint = document.getElementById("manualPeerHint");
  const localOwnIp = document.getElementById("localOwnIp");
  let sendTimer = null;
  let started = false;

  function setLocalUi(state, peers = 0, detail = "") {
    const active = state === "active";
    const searching = state === "searching";
    statusText.textContent = active ? "Sikker lokal synk" : searching ? "Søker sikkert lokalt" : "Lokal synk stoppet";
    statusDot.className = `status-dot ${active ? "online" : searching ? "connecting" : "offline"}`;
    peerCount.textContent = peers > 0 ? `${peers + 1} telefoner · kryptert` : "Bare denne telefonen";
    localStatus.textContent = active ? "Kryptert lokal synk er aktiv" : searching ? "Søker etter sikre peers …" : "Lokal synk er stoppet";
    localPeers.textContent = detail || (peers > 0 ? `${peers} sikker peer${peers === 1 ? "" : "s"} funnet` : "Oppgaver lagres lokalt mens appen søker");
    localPulse.className = `local-pulse ${active ? "" : searching ? "searching" : "offline"}`.trim();
  }

  function queueWorkspaceSend(delay = 220) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(WORKSPACE_KEY) || JSON.stringify({ version: 2, tasks: [], chat: [], updatedAt: new Date().toISOString() });
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
        mergeWorkspace(JSON.parse(String(raw)));
        queueWorkspaceSend(650);
      } catch (error) {
        setLocalUi("searching", 0, `Ignorerte ugyldig sikker pakke: ${error?.message || error}`);
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
      channelHeading.textContent = "Sikkert lokalnett";
      encryptedBadge.textContent = "🔒 AES-256";
      encryptedBadge.title = "ECDH P-256 nøkkelutveksling og AES-256-GCM for arbeidsdata.";
      setLocalUi("searching", 0);
      window.NativeLocal.start();
      started = true;
      const ownIp = String(window.NativeLocal?.getLocalAddress?.() || "");
      localOwnIp.textContent = ownIp || "ukjent";
      const savedPeer = localStorage.getItem(MANUAL_PEER_KEY) || "";
      manualPeerIp.value = savedPeer;
      if (savedPeer) setTimeout(() => window.NativeLocal?.addPeer?.(savedPeer), 350);
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
    chatInput.disabled = true;
    if (chatButton) chatButton.disabled = true;
    setLocalUi("offline", 0);
  }

  window.addEventListener("nest:workspace-changed", () => {
    if (started) queueWorkspaceSend();
  });

  restart?.addEventListener("click", () => {
    stopLocal();
    setTimeout(startLocal, 180);
  });

  addManualPeer?.addEventListener("click", () => {
    const host = manualPeerIp.value.trim();
    if (!host) return;
    localStorage.setItem(MANUAL_PEER_KEY, host);
    manualPeerHint.textContent = `Sender sikker håndhilsen til ${host} …`;
    try { window.NativeLocal?.addPeer?.(host); }
    catch (error) { manualPeerHint.textContent = String(error?.message || error); }
  });

  window.addEventListener("beforeunload", () => {
    try { window.NativeLocal?.stop?.(); } catch {}
  });

  startLocal();
})();

/* NEST_COMIC_ABOUT_V1 */
(() => {
  "use strict";

  const dialog = document.getElementById("aboutDialog");
  if (!dialog || dialog.querySelector(".about-comic")) return;

  const section = document.createElement("section");
  section.className = "about-comic";
  section.setAttribute("aria-labelledby", "aboutComicTitle");
  section.innerHTML = `
    <div class="about-section-heading">
      <p class="about-overline">TEGNESERIEN</p>
      <h3 id="aboutComicTitle">Fra flat liste til riktig neste steg.</h3>
      <p>Se hele modellen i én skjermvennlig stripe: problemet, dørprinsippet, arbeidsflyten og hvordan NEST Channel rydder veien videre.</p>
    </div>
    <figure class="about-comic-frame">
      <img src="nest-channel-comic.webp" alt="Tegneserie som forklarer betinget oppgavebehandling i NEST Channel" loading="lazy" decoding="async">
      <figcaption>Klar kan gjøres nå. Venter trenger et ferdig vilkår. Ferdig åpner neste oppgave.</figcaption>
    </figure>
  `;

  const anchor = dialog.querySelector(".about-principles") || dialog.querySelector(".about-product-note");
  if (anchor) anchor.before(section);
  else dialog.querySelector(".about-shell")?.append(section);

  const style = document.createElement("style");
  style.textContent = `
    .about-comic{padding:clamp(1.6rem,5vw,3.5rem);border-bottom:1px solid var(--line)}
    .about-comic .about-section-heading>p:last-child{max-width:760px;margin-top:.85rem;color:#b7c6bd;line-height:1.65}
    .about-comic-frame{margin:1.5rem auto 0;width:min(100%,800px);overflow:hidden;border:1px solid rgba(105,240,174,.24);border-radius:20px;background:#030806;box-shadow:0 22px 70px rgba(0,0,0,.32)}
    .about-comic-frame img{display:block;width:100%;height:auto}
    .about-comic-frame figcaption{padding:.9rem 1rem 1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem;line-height:1.5;text-align:center}
    @media(max-width:560px){.about-comic{padding:1.15rem .8rem}.about-comic-frame{margin-top:1rem;border-radius:14px}.about-comic-frame figcaption{font-size:.75rem}}
  `;
  document.head.append(style);

  const version = dialog.querySelector(".about-footer span");
  if (version) version.textContent = "Versjon 0.5.0 · BLCKSWAN";
})();
