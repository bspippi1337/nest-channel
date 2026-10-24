/* NEST 0.9.1 PTT: live WebRTC media; GitHub carries only AES-GCM encrypted signaling. */
(() => {
  "use strict";
  const MARKER = "<!-- NEST-VOICE-V1 -->";
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const $ = id => document.getElementById(id);
  const b64 = a => { let out = ""; a.forEach(v => { out += String.fromCharCode(v); }); return btoa(out); };
  const un64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const peerId = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2,"0")).join("");
  let pc = null, audio = null, stream = null, dc = null;
  let active = false, remoteId = "", otherTalking = false, talk = false;
  let seen = new Set(), signalTimer = null, announceTimer = null, lastSince = "";
  let busy = false, selectedIssue = 0, selectedRepo = "";
  let statusNode, mainButton, pttButton, audioNode;
  let failures = 0;
  const state = () => ({
    room: typeof roomId === "string" ? roomId : "",
    key: typeof roomKey === "object" && roomKey ? roomKey : null,
    repo: $("relayUrl")?.value.trim() || "",
    connected: window.NEST_GITHUB_CONNECTED === true
  });
  const soundReady = () => stream && stream.getAudioTracks().length > 0;
  function status(message) { if (statusNode) statusNode.textContent = message; }
  function error(message) { status("Radio: " + String(message || "ukjent feil")); }
  function responseJson(response) { return response.json().catch(() => ({})); }
  function token() { return String(window.NativeHost?.loadSecret?.("github_token") || ""); }
  async function github(path, method = "GET", data) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 18000);
    try {
      const resp = await fetch("https://api.github.com" + path, {
        method, signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token(),
          "X-GitHub-Api-Version": "2022-11-28",
          ...(data ? { "Content-Type": "application/json" } : {})
        }, ...(data ? { body: JSON.stringify(data) } : {})
      });
      const parsed = await responseJson(resp);
      if (!resp.ok) {
        const ex = new Error("GitHub " + resp.status + ": " + (parsed.message || "nettverksfeil"));
        ex.status = resp.status;
        ex.retryAfter = Number(resp.headers.get("retry-after") || 0);
        throw ex;
      }
      return parsed;
    } finally { clearTimeout(timer); }
  }
  function apiPath() {
    const [owner, repo] = selectedRepo.split("/");
    return "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/issues/" + selectedIssue + "/comments";
  }
  async function encrypt(message) {
    const room = state().room, key = state().key;
    if (!key || !room) throw new Error("Kanalnøkkel mangler.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode("NEST-PTT-V1:" + room) },
      key, encoder.encode(JSON.stringify(message))
    ));
    return { v: 1, room, id: crypto.randomUUID(), iv: b64(iv), data: b64(data) };
  }
  async function decrypt(envelope) {
    if (envelope.v !== 1 || envelope.room !== state().room || typeof envelope.id !== "string" ||
        !/^[A-Za-z0-9+/=]{12,}$/.test(envelope.iv || "") ||
        !/^[A-Za-z0-9+/=]{16,}$/.test(envelope.data || "")) return null;
    const bytes = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: un64(envelope.iv), additionalData: encoder.encode("NEST-PTT-V1:" + state().room)
    }, state().key, un64(envelope.data));
    const message = JSON.parse(decoder.decode(bytes));
    if (!message || typeof message !== "object" || typeof message.from !== "string" ||
        !/^[a-f0-9]{32}$/.test(message.from) || !["hello","offer","answer","bye"].includes(message.action) ||
        !Number.isFinite(message.at) || Math.abs(Date.now() - message.at) > 180000) return null;
    if (message.to && message.to !== peerId) return null;
    return message;
  }
  async function sendSignal(action, extra = {}) {
    if (!active) return;
    const envelope = await encrypt({ action, from: peerId, to: remoteId || "", at: Date.now(), ...extra });
    await github(apiPath(), "POST", { body: MARKER + "\n" + JSON.stringify(envelope) });
  }
  function clearConnection({ releaseMic = false } = {}) {
    if (dc) { try { dc.close(); } catch {} dc = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    remoteId = ""; otherTalking = false;
    if (audioNode) audioNode.srcObject = null;
    if (releaseMic && stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    mute();
  }
  async function waitIceComplete(connection) {
    if (connection.iceGatheringState === "complete") return;
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error("ICE candidate-søk tok for lang tid.")); }, 15000);
      function handle() { if (connection.iceGatheringState === "complete") { cleanup(); resolve(); } }
      function cleanup() { clearTimeout(timeout); connection.removeEventListener("icegatheringstatechange", handle); }
      connection.addEventListener("icegatheringstatechange", handle);
      handle();
    });
  }
  function attachControl(channel) {
    dc = channel;
    dc.onmessage = event => {
      if (event.data === "talk:start") {
        // Deterministic collision policy avoids both radios muting forever.
        if (talk && peerId < remoteId) {
          if (dc.readyState === "open") dc.send("talk:busy");
          return;
        }
        if (talk) endTalk();
        otherTalking = true;
        status("Motparten snakker");
      } else if (event.data === "talk:busy") {
        if (talk) endTalk();
        otherTalking = true;
        status("Motparten har taleretten");
      } else if (event.data === "talk:stop") {
        otherTalking = false;
        if (!talk) status("Klar · hold inne for å snakke");
      }
    };
    dc.onopen = () => status("Direkte forbindelse · hold inne for å snakke");
  }
  function createConnection() {
    if (!soundReady()) throw new Error("Mikrofonen er ikke tilgjengelig.");
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }]
    });
    pc = connection;
    stream.getTracks().forEach(track => { track.enabled = false; connection.addTrack(track, stream); });
    connection.ontrack = ev => {
      audioNode.srcObject = ev.streams?.[0] || new MediaStream([ev.track]);
      audioNode.play().catch(() => status("Trykk på radioen for å aktivere lydavspilling"));
    };
    connection.ondatachannel = e => attachControl(e.channel);
    connection.onconnectionstatechange = () => {
      if (pc !== connection || !active) return;
      if (connection.connectionState === "connected") {
        clearTimeout(announceTimer);
        status("Live forbindelse · hold inne for å snakke");
      } else if (["failed","disconnected"].includes(connection.connectionState)) {
        mute(); status("Radioforbindelsen er brutt. Koble til på nytt.");
      }
    };
    return connection;
  }
  async function offerTo(id) {
    if (!active || pc) return;
    remoteId = id;
    status("Setter opp direkte forbindelse …");
    const connection = createConnection();
    attachControl(connection.createDataChannel("nest-ptt-control", { ordered: true }));
    const offer = await connection.createOffer({ offerToReceiveAudio: true });
    await connection.setLocalDescription(offer);
    await waitIceComplete(connection);
    await sendSignal("offer", { description: {
      type: connection.localDescription.type, sdp: connection.localDescription.sdp
    } });
  }
  async function acceptOffer(message) {
    if (!active || pc || !message.description || message.description.type !== "offer") return;
    remoteId = message.from;
    status("Svar til telefon nummer to …");
    const connection = createConnection();
    await connection.setRemoteDescription(new RTCSessionDescription(message.description));
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await waitIceComplete(connection);
    await sendSignal("answer", { description: {
      type: connection.localDescription.type, sdp: connection.localDescription.sdp
    } });
  }
  async function consume(comment) {
    if (!active || !comment?.id || seen.has(comment.id)) return;
    if (seen.size > 1500) seen = new Set();
    seen.add(comment.id);
    if (!String(comment.body || "").startsWith(MARKER)) return;
    let message;
    try { message = await decrypt(JSON.parse(comment.body.slice(MARKER.length).trim())); }
    catch { return; } // Invalid MAC, outdated, or other channel: ignore.
    if (!message || message.from === peerId) return;
    if (message.action === "bye" && message.from === remoteId) {
      clearConnection(); status("Motparten avsluttet. Søker etter ny forbindelse …");
      await sendSignal("hello", { to: "" });
      return;
    }
    if (message.action === "hello") {
      if (!pc && peerId < message.from) await offerTo(message.from);
    } else if (message.action === "offer") {
      if (!pc) await acceptOffer(message);
    } else if (message.action === "answer" && pc && remoteId === message.from &&
               pc.signalingState === "have-local-offer" && message.description?.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(message.description));
    }
  }
  async function poll() {
    if (!active) return;
    let delay = pc?.connectionState === "connected" ? 20000 : 6000;
    try {
      const since = lastSince ? "&since=" + encodeURIComponent(lastSince) : "";
      const rows = await github(apiPath() + "?per_page=100" + since);
      let latest = lastSince;
      for (const row of rows) {
        if (row.created_at > latest) latest = row.created_at;
        await consume(row);
      }
      // Overlap 3 seconds for timestamp precision; seen IDs prevent replays.
      const nextMs = Date.parse(latest);
      if (Number.isFinite(nextMs)) lastSince = new Date(nextMs - 3000).toISOString();
      failures = 0;
    } catch (e) {
      failures += 1;
      delay = Math.max(delay, e.retryAfter ? e.retryAfter * 1000 : 0,
        e.status === 429 || e.status === 403 ? 60000 : Math.min(60000, 3000 * 2 ** Math.min(failures, 5)));
      error(e.message);
    } finally { if (active) signalTimer = setTimeout(poll, delay); }
  }
  async function announce() {
    if (!active || pc?.connectionState === "connected") return;
    await sendSignal("hello", { to: "" });
    if (active) announceTimer = setTimeout(() => announce().catch(e => error(e.message)), 30000);
  }
  function mute() {
    talk = false;
    if (stream) stream.getAudioTracks().forEach(track => { track.enabled = false; });
    pttButton?.classList.remove("talking");
    pttButton?.setAttribute("aria-pressed", "false");
  }
  function startTalk() {
    if (!active || otherTalking || !pc || pc.connectionState !== "connected" || dc?.readyState !== "open" || !soundReady()) return;
    talk = true;
    stream.getAudioTracks().forEach(track => { track.enabled = true; });
    if (dc?.readyState === "open") dc.send("talk:start");
    pttButton.classList.add("talking"); pttButton.setAttribute("aria-pressed", "true");
    status("Sender live lyd …");
  }
  function endTalk() {
    if (!talk) return;
    mute();
    if (dc?.readyState === "open") dc.send("talk:stop");
    status("Klar · hold inne for å snakke");
  }
  async function turnOn() {
    if (busy || active) return;
    busy = true; mainButton.disabled = true;
    try {
      window.NESTSecurity?.requireRadioAllowed();
      const details = state();
      if (!details.connected || !details.key || !details.room) throw new Error("Koble til kryptert GitHub-kanal først.");
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(details.repo)) throw new Error("Ugyldig GitHub-repo.");
      if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("WebRTC-mikrofon er ikke tilgjengelig på denne enheten.");
      }
      if (!token()) throw new Error("GitHub-innlogging mangler.");
      const issueKey = "nest.github.issue.v1:" + details.repo + ":" + details.room;
      const number = Number(localStorage.getItem(issueKey));
      if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Kunne ikke finne GitHub-kanalen.");
      selectedRepo = details.repo; selectedIssue = number;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
      });
      mute();
      // Prime media playback as part of the explicit activation gesture.
      audioNode.volume = 1;
      active = true;
      mainButton.textContent = "Avslutt radio";
      pttButton.disabled = false;
      lastSince = new Date(Date.now() - 60000).toISOString();
      status("Søker etter den andre telefonen …");
      await announce();
      await poll();
    } catch (e) {
      active = false; clearConnection({ releaseMic: true }); error(e.message);
    } finally { busy = false; mainButton.disabled = false; }
  }
  async function turnOff() {
    if (!active) return;
    endTalk();
    try { await sendSignal("bye"); } catch {}
    active = false;
    clearTimeout(signalTimer); clearTimeout(announceTimer);
    signalTimer = announceTimer = null;
    clearConnection({ releaseMic: true });
    mainButton.textContent = "Aktiver live radio";
    pttButton.disabled = true;
    status("Radio av · mikrofon lukket");
  }
  function init() {
    if ($("nest91-radio")) return;
    const panel = document.createElement("section");
    panel.id = "nest91-radio"; panel.className = "nest91-radio";
    const label = document.createElement("h3");
    label.textContent = "NEST LIVE · WALKIE TALKIE";
    statusNode = document.createElement("p");
    statusNode.id = "nest91-radio-status";
    statusNode.textContent = "Radio av · mikrofon lukket";
    mainButton = document.createElement("button");
    mainButton.type = "button"; mainButton.textContent = "Aktiver live radio";
    mainButton.className = "nest91-radio-start";
    mainButton.onclick = () => active ? turnOff() : turnOn();
    pttButton = document.createElement("button");
    pttButton.type = "button"; pttButton.textContent = "HOLD INNE · SNAKK";
    pttButton.className = "nest91-radio-talk";
    pttButton.disabled = true;
    pttButton.setAttribute("aria-pressed", "false");
    pttButton.addEventListener("pointerdown", e => {
      if (pttButton.disabled) return;
      e.preventDefault(); pttButton.setPointerCapture(e.pointerId); startTalk();
    });
    ["pointerup","pointercancel","lostpointercapture"].forEach(event => pttButton.addEventListener(event, endTalk));
    pttButton.addEventListener("keydown", e => {
      if (e.code === "Space" && !e.repeat) { e.preventDefault(); startTalk(); }
    });
    pttButton.addEventListener("keyup", e => { if (e.code === "Space") { e.preventDefault(); endTalk(); } });
    window.addEventListener("blur", endTalk);
    document.addEventListener("visibilitychange", () => { if (document.hidden) endTalk(); });
    audioNode = document.createElement("audio");
    audioNode.autoplay = true; audioNode.playsInline = true; audioNode.style.display = "none";
    panel.append(label, statusNode, mainButton, pttButton, audioNode);
    const holder = document.querySelector(".channel-pane") || document.querySelector(".app-frame") || document.body;
    holder.append(panel);
    window.NestPTT091 = { stop: turnOff, connected: () => pc?.connectionState === "connected" };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
