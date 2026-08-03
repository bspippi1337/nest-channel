(() => {
  const MODE_KEY = "nest.channel.mode.v1";
  const modeHost = document.getElementById("modeHost");
  const modeClient = document.getElementById("modeClient");
  const description = document.getElementById("modeDescription");
  const hostPanel = document.getElementById("hostPanel");
  const hostAddress = document.getElementById("hostAddress");
  const copyButton = document.getElementById("copyHostAddress");
  const relayInput = document.getElementById("relayUrl");
  const relayLabel = document.getElementById("relayLabel");
  const connectButton = document.getElementById("connectButton");

  let mode = localStorage.getItem(MODE_KEY) || "client";
  let shareAddress = "";

  function nativeHostAvailable() {
    return typeof window.NativeHost === "object" && typeof window.NativeHost.startHost === "function";
  }

  function updateButtons() {
    modeHost.classList.toggle("active", mode === "host");
    modeClient.classList.toggle("active", mode === "client");
  }

  function startNativeHost() {
    if (!nativeHostAvailable()) {
      hostAddress.textContent = "Vertmodus krever Android-APK-en";
      hostAddress.classList.add("error-text");
      return;
    }

    try {
      shareAddress = String(window.NativeHost.startHost() || "");
      relayInput.value = "ws://127.0.0.1:8787";
      hostAddress.textContent = shareAddress || "Relé startet på port 8787";
      hostAddress.classList.remove("error-text");
    } catch (error) {
      hostAddress.textContent = `Kunne ikke starte vert: ${error.message || error}`;
      hostAddress.classList.add("error-text");
    }
  }

  function stopNativeHost() {
    if (!nativeHostAvailable()) return;
    try {
      window.NativeHost.stopHost();
    } catch {}
  }

  function applyMode(nextMode, { stopPrevious = true } = {}) {
    const previous = mode;
    mode = nextMode === "host" ? "host" : "client";
    localStorage.setItem(MODE_KEY, mode);
    updateButtons();

    if (mode === "host") {
      hostPanel.hidden = false;
      relayLabel.hidden = true;
      relayInput.readOnly = true;
      description.textContent = "Denne telefonen lagrer og videresender kanaltrafikken.";
      connectButton.textContent = "Start vert og koble til";
      startNativeHost();
      return;
    }

    hostPanel.hidden = true;
    relayLabel.hidden = false;
    relayInput.readOnly = false;
    description.textContent = "Koble til adressen som vises på vertstelefonen.";
    connectButton.textContent = "Koble til kanal";
    if (stopPrevious && previous === "host") stopNativeHost();
    if (relayInput.value === "ws://127.0.0.1:8787") relayInput.value = "";
  }

  modeHost.addEventListener("click", () => applyMode("host"));
  modeClient.addEventListener("click", () => applyMode("client"));

  connectButton.addEventListener("click", () => {
    if (mode === "host") {
      startNativeHost();
      relayInput.value = "ws://127.0.0.1:8787";
    }
  }, true);

  copyButton.addEventListener("click", async () => {
    if (!shareAddress) return;
    try {
      await navigator.clipboard.writeText(shareAddress);
      copyButton.textContent = "Kopiert";
    } catch {
      const area = document.createElement("textarea");
      area.value = shareAddress;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      copyButton.textContent = "Kopiert";
    }
    setTimeout(() => { copyButton.textContent = "Kopier adresse"; }, 1400);
  });

  applyMode(mode, { stopPrevious: false });
})();
