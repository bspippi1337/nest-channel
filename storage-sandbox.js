(() => {
  const BASE_KEY = "nest.channel.workspace.v1";
  const NS_KEY = "nest.channel.storage.namespace";
  const PASSWORD_KEY = "nest.channel.storage.password";
  const AUTOCONNECT_KEY = "nest.channel.storage.autoconnect";
  const SETTINGS_KEY = "nest.channel.settings.v1";
  const namespace = localStorage.getItem(NS_KEY) || ".offline";

  const originalGet = Storage.prototype.getItem;
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;

  function mapKey(storage, key) {
    return storage === localStorage && key === BASE_KEY ? `${BASE_KEY}${namespace}` : key;
  }

  Storage.prototype.getItem = function (key) {
    return originalGet.call(this, mapKey(this, key));
  };

  Storage.prototype.setItem = function (key, value) {
    return originalSet.call(this, mapKey(this, key), value);
  };

  Storage.prototype.removeItem = function (key) {
    return originalRemove.call(this, mapKey(this, key));
  };

  async function roomNamespace(channel) {
    const normalized = channel.trim().replace(/^#/, "").toLocaleLowerCase("nb");
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nest-room:${normalized}`))
    );
    return `.${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("connectButton");
    const channelInput = document.getElementById("channelName");
    const relayInput = document.getElementById("relayUrl");
    const nicknameInput = document.getElementById("nickname");
    const passwordInput = document.getElementById("channelPassword");

    const savedPassword = sessionStorage.getItem(PASSWORD_KEY);
    if (savedPassword) passwordInput.value = savedPassword;

    let replaying = false;
    button.addEventListener("click", async event => {
      if (replaying) {
        replaying = false;
        return;
      }

      const channel = channelInput.value.trim();
      if (!channel) return;

      const targetNamespace = await roomNamespace(channel);
      const currentNamespace = originalGet.call(localStorage, NS_KEY) || ".offline";
      if (targetNamespace === currentNamespace) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      originalSet.call(localStorage, SETTINGS_KEY, JSON.stringify({
        relayUrl: relayInput.value.trim(),
        channelName: channelInput.value.trim(),
        nickname: nicknameInput.value.trim()
      }));
      originalSet.call(localStorage, NS_KEY, targetNamespace);
      sessionStorage.setItem(PASSWORD_KEY, passwordInput.value);
      sessionStorage.setItem(AUTOCONNECT_KEY, "1");
      location.reload();
    }, true);

    if (sessionStorage.getItem(AUTOCONNECT_KEY) === "1") {
      sessionStorage.removeItem(AUTOCONNECT_KEY);
      setTimeout(() => {
        replaying = true;
        button.click();
        sessionStorage.removeItem(PASSWORD_KEY);
      }, 0);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector('link[href="onboarding-v08.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "onboarding-v08.css";
      document.head.append(link);
    }
    if (!document.querySelector('script[src="onboarding-v08.js"]')) {
      const script = document.createElement("script");
      script.src = "onboarding-v08.js";
      script.defer = true;
      document.body.append(script);
    }
    if (!document.querySelector('script[src="release-v09.js"]')) {
      const releaseScript = document.createElement("script");
      releaseScript.src = "release-v09.js";
      releaseScript.defer = true;
      document.body.append(releaseScript);
    }
  });
})();
