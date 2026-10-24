/* High-threat risk reduction, not proof of anonymity or resistance to endpoint compromise. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NESTSecurity = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const KEY = "nest.security.threat-profile.v1";
  const isStrict = () => {
    try { return typeof localStorage === "undefined" || localStorage.getItem(KEY) !== "standard"; }
    catch { return true; } // Denied storage must fail closed.
  };
  function requireNative() {
    if (isStrict() && (typeof window === "undefined" || !window.NativeHost?.saveSecret || !window.NativeHost?.loadSecret))
      throw new Error("Høyrisikoprofil krever Android APK og Android Keystore. Nettleserversjonen er ikke godkjent.");
    return true;
  }
  function requirePrivateRepo(data) {
    if (isStrict() && (!data || data.private !== true))
      throw new Error("Høyrisikoprofil blokkerer offentlige repoer. Bruk et NYTT privat repo.");
    return true;
  }
  function requireStrongChannelKey(secret) {
    const candidate = String(secret || "");
    // Form validation alone is not entropy proof; reject obvious low-entropy strings.
    const shape = /^[A-Za-z0-9_-]{43}$/.test(candidate) && /[A-Z]/.test(candidate)
      && /[a-z]/.test(candidate) && /[0-9_-]/.test(candidate)
      && new Set(candidate).size >= 16;
    if (isStrict() && !shape)
      throw new Error("Høyrisikoprofil krever en tilfeldig generert 256-bits kanalnøkkel fra veiviseren.");
    return true;
  }
  function requireRadioAllowed() {
    if (isStrict()) throw new Error("Høyrisikoprofil blokkerer live-radio: WebRTC/STUN kan røpe IP-adresser. Anonym relay er ikke implementert.");
    return true;
  }
  function requireClipboardAllowed() {
    if (isStrict()) throw new Error("Høyrisikoprofil blokkerer kopiering av kanalhemmeligheter til utklippstavlen.");
    return true;
  }
  function setupUi() {
    if (typeof document === "undefined") return;
    const container = document.querySelector(".topbar-actions");
    if (!container) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost nest-threat-button";
    btn.setAttribute("aria-label", "Endre sikkerhetsprofil");
    const refresh = () => {
      btn.textContent = isStrict() ? "Høyrisikoprofil · PÅ" : "Standard beta · IKKE ANONYM";
      btn.title = isStrict() ? "Blokkerer usikre standardvalg; appen er fortsatt ikke sikkerhetssertifisert."
        : "Standard beta kan eksponere IP, trafikkmetadata og hemmelige invitasjoner.";
    };
    refresh();
    btn.addEventListener("click", () => {
      const downgrade = isStrict();
      const message = downgrade
        ? "Slå AV høyrisikoprofil? Offentlige repoer, kortere passord, utklippstavle og WebRTC med IP-eksponering blir tilgjengelig. IKKE bruk i risikoområder."
        : "Slå PÅ høyrisikoprofil? Offentlige repoer, korte passord, utklippstavle og WebRTC sperres. Appen er fortsatt IKKE godkjent for høyrisikobruk.";
      if (!window.confirm(message)) return;
      try { localStorage.setItem(KEY, downgrade ? "standard" : "strict"); }
      catch { alert("Sikkerhetsprofilen kunne ikke lagres. Streng modus forblir aktiv."); return; }
      location.reload();
    });
    container.prepend(btn);
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupUi, { once: true });
    else setupUi();
  }
  return Object.freeze({ isStrict, requireNative, requirePrivateRepo, requireStrongChannelKey, requireRadioAllowed, requireClipboardAllowed });
});
