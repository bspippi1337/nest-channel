/* N3ST // SHELL · encrypted room voice notes & safe virtual terminal */
(() => {
  "use strict";
  const VOICE_PREFIX = "NESTVOICE1|";
  const MAX_RECORD_MS = 12000;
  const MAX_AUDIO_BYTES = 96000;
  const chatForm = document.getElementById("chatForm");
  const chatList = document.getElementById("chatList");
  const topbar = document.querySelector(".topbar-actions");
  if (!chatForm || !chatList || !topbar || !window.NESTCore) return;

  const voiceButton = document.createElement("button");
  voiceButton.type = "button";
  voiceButton.id = "nestPttButton";
  voiceButton.className = "nest-ptt";
  voiceButton.textContent = "🎙 Hold for å snakke";
  voiceButton.title = "Hold inne for å ta opp, slipp for å sende. Maks 12 sekunder.";
  voiceButton.setAttribute("aria-label", "Hold inne for å sende talemelding");
  chatForm.append(voiceButton);
  const voiceStatus = document.createElement("div");
  voiceStatus.className = "nest-voice-status";
  voiceStatus.setAttribute("role", "status");
  voiceStatus.setAttribute("aria-live", "polite");
  voiceStatus.textContent = "PTT · 12 sek maks · sendes kryptert via aktiv NEST-kanal";
  chatForm.after(voiceStatus);

  const shellButton = document.createElement("button");
  shellButton.type = "button";
  shellButton.className = "nest-shell-launch";
  shellButton.textContent = "⌘ SHELL";
  topbar.prepend(shellButton);
  const dialog = document.createElement("dialog");
  dialog.id = "nestShellDialog";
  dialog.className = "nest-shell-dialog";
  dialog.innerHTML =
    '<section class="nest-console">' +
    '<header class="nest-console-heading"><div><span class="nest-kicker">BLCKSWAN // BUILD 42</span><h2>N3ST <em>SHELL</em></h2>' +
    '<p>Linux × Android × reality. Virtuell terminal, ekte NEST-funksjoner.</p></div>' +
    '<button id="nestShellClose" type="button" aria-label="Lukk terminal">✕</button></header>' +
    '<div class="nest-leds"><span>● LOCAL UI</span><span id="nestShellRoom">○ ROOM</span><span>◎ NO ROOT</span></div>' +
    '<nav class="nest-shortcuts" aria-label="Hurtigkommandoer">' +
    '<button type="button" data-cmd="help">help</button><button type="button" data-cmd="status">status</button>' +
    '<button type="button" data-cmd="aliases">aliases</button><button type="button" data-cmd="crypto">crypto</button>' +
    '<button type="button" data-cmd="diploma">diploma</button></nav>' +
    '<pre id="nestTerminalOutput" class="nest-terminal-output" aria-live="polite"></pre>' +
    '<form id="nestShellForm" autocomplete="off"><label for="nestShellInput">pippi@nest:~$</label>' +
    '<input id="nestShellInput" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="help">' +
    '<button type="submit">RUN ↵</button></form>' +
    '<div class="nest-console-footer">Ingen vilkårlig kommandokjøring eller root. GitHub-synk og kryptering styres av NEST.</div>' +
    '</section>';
  document.body.append(dialog);
  const output = dialog.querySelector("#nestTerminalOutput");
  const terminalInput = dialog.querySelector("#nestShellInput");
  const terminalForm = dialog.querySelector("#nestShellForm");
  const aliases = { cat: "dog", dog: "ls -l", more: "less", echo: "print", grep: "search", ll: "ls -l" };

  function line(value) {
    output.textContent += String(value) + "\n";
    if (output.textContent.length > 14000) output.textContent = output.textContent.slice(-11000);
    output.scrollTop = output.scrollHeight;
  }
  function roomActive() {
    return Boolean(window.NEST_GITHUB_CONNECTED || window.NEST_LOCAL_CONNECTED);
  }
  function roomInfo() {
    return document.getElementById("channelHeading")?.textContent?.trim() || "Offline";
  }
  function run(raw) {
    const command = String(raw || "").trim();
    if (!command) return;
    line("pippi@nest:~$ " + command);
    const pieces = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const head = (pieces.shift() || "").toLowerCase();
    const args = pieces.join(" ").replace(/^"|"$/g, "");
    const name = aliases[head] || head;
    const target = name.split(/\s+/)[0];
    if (target === "clear") { output.textContent = ""; return; }
    if (target === "help") {
      line("help · status · whoami · date · pwd · ls · tasks · chat · aliases");
      line("cat/dog · more/less · echo/print · crypto · github · ptt · privacy · diploma · clear");
    } else if (target === "status" || target === "sync") {
      line("ROOM   " + (roomActive() ? "CONNECTED" : "OFFLINE") + "  " + roomInfo());
      line("TASKS  " + (workspace.tasks || []).filter(t => !t.deleted).length);
      line("CHAT   " + (workspace.chat || []).length + " messages");
      line("MODE   " + (window.NEST_GITHUB_CONNECTED ? "GitHub E2EE" : window.NEST_LOCAL_CONNECTED ? "Local trusted P2P" : "Disconnected"));
    } else if (target === "whoami") {
      line(document.getElementById("nickname")?.value?.trim() || "Pippi");
    } else if (target === "date") {
      line(new Date().toLocaleString("nb-NO"));
    } else if (target === "pwd") {
      line("/nest/channel");
    } else if (target === "ls") {
      line("tasks/   chat/   alias.conf   channel.info");
    } else if (target === "tasks" || target === "dog") {
      const tasks = (workspace.tasks || []).filter(t => !t.deleted);
      line(tasks.length ? tasks.slice(0, 20).map(t => "[ " + (t.done ? "DONE" : NESTCore.taskState(workspace.tasks, t).toUpperCase()) + " ] " + t.title).join("\n") : "(ingen oppgaver)");
    } else if (target === "chat") {
      line("Messages: " + workspace.chat.length + " · Voice: " + workspace.chat.filter(m => m.text?.startsWith(VOICE_PREFIX)).length);
    } else if (target === "aliases" || target === "alias") {
      line(Object.entries(aliases).map(([from, to]) => "alias " + from + "='" + to + "'").join("\n"));
      line("Virtuelle aliaser i NEST. De endrer ikke Termux.");
    } else if (target === "more" || target === "less") {
      line("Bruk oppgavelisten og chatten for faktisk innhold; ingen shell-filsystemtilgang.");
    } else if (target === "print") {
      line(args);
    } else if (target === "crypto") {
      line("GitHub: AES-256-GCM E2EE når romnøkkel er aktiv.");
      line("Lokal: QR-paret identitet + signert ECDH-sesjon.");
      line("Lokal workspace-cache kan ligge ukryptert i appdata.");
      line("Nøkkelen til en kanal kommer fra kanalpassordet.");
    } else if (target === "github") {
      line("https://github.com/bspippi1337/nest-channel");
    } else if (target === "ptt") {
      line("Hold 🎙-knappen i chatten, slipp for å sende kryptert talemelding.");
      line("Mikrofontillatelse og aktiv kanal kreves. Maks 12 sekunder.");
    } else if (target === "privacy") {
      line("Ingen opplasting av lyd før du slipper PTT og meldingen legges til i workspace.");
      line("NEST synkroniserer krypterte snapshots, men lagrer lokal cache i appdata.");
      line("Terminalen kjører ikke kommandolinjeprogrammer.");
    } else if (target === "diploma") {
      line("+------------------------------------------+");
      line("|      N3ST // WINNER CERTIFICATE          |");
      line("|                                          |");
      line("|        PIPPI 1 : REALITY 0               |");
      line("|    Linux × Android × Imagination         |");
      line("|                                          |");
      line("|   Signed: BLCKSWAN / NEST CHANNEL        |");
      line("+------------------------------------------+");
    } else {
      line("Ukjent kommando: " + head + ". Skriv help.");
    }
  }
  shellButton.addEventListener("click", () => {
    const indicator = dialog.querySelector("#nestShellRoom");
    indicator.textContent = (roomActive() ? "● " : "○ ") + roomInfo().slice(0, 30);
    if (!dialog.open) dialog.showModal();
    if (!output.textContent) { line("N3ST SHELL v0.9 · alias layer online"); line("Skriv help for kommandoer."); }
    terminalInput.focus();
  });
  dialog.querySelector("#nestShellClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.querySelector(".nest-shortcuts").addEventListener("click", event => {
    const button = event.target.closest("[data-cmd]");
    if (button) run(button.dataset.cmd);
  });
  terminalForm.addEventListener("submit", event => {
    event.preventDefault(); run(terminalInput.value); terminalInput.value = ""; terminalInput.focus();
  });

  const mimeAllowed = value => /^audio\/(webm|ogg|mp4)(;codecs=[\w,.-]+)?$/i.test(value);
  function upgradeVoiceMessages() {
    for (const paragraph of chatList.querySelectorAll(".chat-message p")) {
      if (paragraph.dataset.nestVoice === "1") continue;
      const value = paragraph.textContent || "";
      if (!value.startsWith(VOICE_PREFIX)) continue;
      const second = value.indexOf("|", VOICE_PREFIX.length);
      if (second < 0) continue;
      const mime = value.slice(VOICE_PREFIX.length, second);
      const encoded = value.slice(second + 1);
      if (!mimeAllowed(mime) || encoded.length > 150000 || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) {
        paragraph.textContent = "Ugyldig eller for stor talemelding";
        continue;
      }
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.setAttribute("aria-label", "Talemelding");
      audio.src = "data:" + mime + ";base64," + encoded;
      paragraph.textContent = "";
      paragraph.dataset.nestVoice = "1";
      const label = document.createElement("small");
      label.textContent = "🎙 Talemelding · kryptert kanalsynk";
      paragraph.append(label, audio);
      paragraph.classList.add("nest-voice-message");
    }
  }
  const chatObserver = new MutationObserver(upgradeVoiceMessages);
  chatObserver.observe(chatList, { childList: true });
  upgradeVoiceMessages();

  let session = null;
  function status(value, error = false) {
    voiceStatus.textContent = value;
    voiceStatus.classList.toggle("is-error", error);
  }
  function cleanup(s) {
    clearTimeout(s.timer);
    s.stream?.getTracks().forEach(track => track.stop());
    if (session === s) session = null;
    voiceButton.classList.remove("is-recording");
    voiceButton.textContent = "🎙 Hold for å snakke";
    voiceButton.setAttribute("aria-pressed", "false");
  }
  async function beginRecording() {
    if (session) return;
    if (!roomActive()) { status("Koble til en kanal først.", true); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      status("Mikrofonopptak støttes ikke i denne WebView/nettleseren.", true);
      return;
    }
    const s = { held: true, parts: [], stream: null, recorder: null, timer: null };
    session = s;
    voiceButton.classList.add("is-recording");
    voiceButton.textContent = "● Starter mikrofon…";
    voiceButton.setAttribute("aria-pressed", "true");
    status("Ber om mikrofontillatelse…");
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (session !== s) { s.stream.getTracks().forEach(track => track.stop()); return; }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type));
      const options = { audioBitsPerSecond: 16000 };
      if (mime) options.mimeType = mime;
      const recorder = new MediaRecorder(s.stream, options);
      s.recorder = recorder;
      recorder.addEventListener("dataavailable", event => { if (event.data.size) s.parts.push(event.data); });
      recorder.addEventListener("error", () => status("Kunne ikke ta opp lyd.", true));
      recorder.addEventListener("stop", async () => {
        const blob = new Blob(s.parts, { type: (recorder.mimeType || mime || "audio/webm").toLowerCase() });
        cleanup(s);
        if (!blob.size) { status("Opptaket ble for kort. Hold knappen lenger.", true); return; }
        if (blob.size > MAX_AUDIO_BYTES) { status("Opptaket var for stort. Prøv kortere.", true); return; }
        const data = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const byte of data) binary += String.fromCharCode(byte);
        const contentType = blob.type.split(";")[0];
        if (!mimeAllowed(contentType)) { status("Lydformatet støttes ikke.", true); return; }
        if (!roomActive()) { status("Kanalen ble koblet fra. Opptaket ble ikke sendt.", true); return; }
        workspace.chat.push({
          id: crypto.randomUUID(),
          author: connectedNickname || document.getElementById("nickname")?.value?.trim() || "Ukjent",
          text: VOICE_PREFIX + contentType + "|" + btoa(binary),
          clientId: clientId,
          createdAt: new Date().toISOString()
        });
        workspace.chat = workspace.chat.slice(-300);
        persist();
        status("Talemelding sendt til kanalsynk (" + Math.round(blob.size / 1024) + " KiB).");
      });
      recorder.start(250);
      voiceButton.textContent = "● Spiller inn… slipp for å sende";
      status("Opptak pågår. Slipp knappen for å sende (maks 12 sekunder).");
      s.timer = setTimeout(() => { s.held = false; finishRecording(); }, MAX_RECORD_MS);
      if (!s.held) finishRecording();
    } catch (error) {
      cleanup(s);
      status("Mikrofon utilgjengelig: " + (error?.name || "tillatelse mangler"), true);
    }
  }
  function finishRecording() {
    if (!session) return;
    session.held = false;
    if (session.recorder?.state === "recording") {
      session.recorder.stop();
      voiceButton.textContent = "Sender…";
    }
  }
  voiceButton.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    try { voiceButton.setPointerCapture(event.pointerId); } catch {}
    beginRecording();
  });
  window.addEventListener("pointerup", finishRecording);
  window.addEventListener("pointercancel", finishRecording);
  voiceButton.addEventListener("keydown", event => {
    if (!event.repeat && (event.key === " " || event.key === "Enter")) {
      event.preventDefault(); beginRecording();
    }
  });
  voiceButton.addEventListener("keyup", event => {
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); finishRecording(); }
  });
  voiceButton.addEventListener("contextmenu", event => event.preventDefault());
})();