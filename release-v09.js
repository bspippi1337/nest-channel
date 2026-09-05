(() => {
  "use strict";

  window.NEST_RELEASE = Object.freeze({
    version: "0.9.0",
    channel: "limited",
    maxDevices: 20,
    targetSdk: 36,
    signing: "release"
  });

  const applyVersion = () => {
    const footer = document.querySelector(".about-footer span");
    if (footer) footer.textContent = "Versjon 0.9.0 · SIGNED BETA · BLCKSWAN";

    const kicker = document.querySelector(".nest-onboard-kicker");
    if (kicker) kicker.textContent = "NEST ZERO-SETUP · v0.9 SIGNED BETA";
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyVersion, { once: true });
  } else {
    applyVersion();
  }
})();
