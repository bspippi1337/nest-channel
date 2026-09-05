(() => {
  "use strict";

  const MODE_KEY = "nest.sync.mode.v1";
  const nativeLocal = () => window.NativeLocal && typeof window.NativeLocal === "object";
  const byId = id => document.getElementById(id);

  function notify(message, timeout = 5200) {
    let host = byId("nestToastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "nestToastHost";
      host.className = "nest-toast-host";
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-atomic", "true");
      document.body.append(host);
    }
    const item = document.createElement("div");
    item.className = "nest-toast shown";
    const text = document.createElement("span");
    text.textContent = String(message || "");
    item.append(text);
    host.append(item);
    setTimeout(() => {
      item.classList.add("leaving");
      setTimeout(() => item.remove(), 180);
    }, timeout);
  }

  function groupedFingerprint(value) {
    const clean = String(value || "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
    return clean.match(/.{1,4}/g)?.join(" ") || "Ukjent";
  }

  function ensureAutoLocal() {
    if (!nativeLocal()) throw new Error("Sikker lokal pairing krever Android-APK-en.");
    const mode = localStorage.getItem(MODE_KEY);
    if (mode !== "local" && mode !== "auto") localStorage.setItem(MODE_KEY, "auto");
    window.NativeLocal.start?.();
  }

  function setupPairingUi() {
    const syncSettings = byId("syncSettings");
    const quick = syncSettings?.querySelector(".sync-quick-actions");
    if (!syncSettings || !quick || byId("nestPairShowButton")) return;

    const show = document.createElement("button");
    show.id = "nestPairShowButton";
    show.className = "ghost";
    show.type = "button";
    show.textContent = "Vis pairing-QR";

    const scan = document.createElement("button");
    scan.id = "nestPairScanButton";
    scan.className = "ghost";
    scan.type = "button";
    scan.textContent = "Skann pairing-QR";

    const trusted = document.createElement("span");
    trusted.id = "nestTrustedPeers";
    trusted.className = "nest-trusted-peers";
    trusted.textContent = "0 verifiserte";

    quick.append(show, scan, trusted);

    const security = document.createElement("details");
    security.className = "nest-local-trust";
    security.innerHTML = `
      <summary>Lokal identitet og tillit</summary>
      <div class="nest-trust-grid">
        <div>
          <small>DENNE TELEFONENS IDENTITET</small>
          <code id="nestIdentityFingerprint">Ukjent</code>
        </div>
        <button id="nestForgetPeers" class="danger" type="button">Glem parede telefoner</button>
      </div>
      <p>Arbeidsdata sendes bare til telefoner som er verifisert gjennom pairing. Discovery kan se andre NEST-enheter, men ukjente identiteter får ingen arbeidskopi.</p>
    `;
    syncSettings.append(security);

    const dialog = document.createElement("dialog");
    dialog.id = "nestPairDialog";
    dialog.className = "nest-pair-dialog";
    dialog.innerHTML = `
      <article class="nest-pair-shell">
        <header>
          <div>
            <p class="eyebrow">LOKAL TILLIT · NESTPAIR1</p>
            <h2>Par telefonene én gang.</h2>
          </div>
          <button id="nestPairClose" class="icon-button" type="button" aria-label="Lukk">×</button>
        </header>
        <div id="nestPairQrWrap" class="nest-pair-qr-wrap" hidden>
          <img id="nestPairQr" alt="QR-kode for sikker lokal pairing">
          <p><strong id="nestPairDeviceName">Denne telefonen</strong></p>
          <code id="nestPairFingerprint">Ukjent</code>
          <p class="nest-pair-note">Skann fra den andre telefonen. Koden er en engangs pairing-hemmelighet, utløper etter fem minutter og skal ikke publiseres.</p>
          <button id="nestPairCopy" class="ghost" type="button">Kopier pairingkode</button>
        </div>
        <div id="nestPairScanState" class="nest-pair-scan-state">
          <strong>Kamera-pairing</strong>
          <p>Den som blir med skanner QR-koden. NEST verifiserer begge permanente identiteter før en flyktig ECDH-sesjonsnøkkel får sende arbeidsdata.</p>
          <button id="nestPairScanFromDialog" class="primary" type="button">Skann QR</button>
          <button id="nestPairPaste" class="text-button" type="button">Lim inn pairingkode manuelt</button>
        </div>
        <div id="nestPairResult" class="nest-pair-result" aria-live="polite"></div>
      </article>
    `;
    document.body.append(dialog);

    let currentPayload = "";
    const setResult = text => { byId("nestPairResult").textContent = String(text || ""); };

    function refreshIdentity() {
      if (!nativeLocal()) {
        show.disabled = true;
        scan.disabled = true;
        trusted.textContent = "Android-APK kreves";
        return;
      }
      try {
        trusted.textContent = `${Number(window.NativeLocal.getTrustedPeerCount?.() || 0)} verifiserte`;
        byId("nestIdentityFingerprint").textContent = groupedFingerprint(window.NativeLocal.getIdentityFingerprint?.());
      } catch {}
    }

    function showQr() {
      try {
        ensureAutoLocal();
        const response = JSON.parse(String(window.NativeLocal.createPairingQr?.() || "{}"));
        if (response.error) throw new Error(response.error);
        if (!response.payload || !response.qr) throw new Error("Kunne ikke lage pairing-QR.");
        currentPayload = response.payload;
        byId("nestPairQr").src = response.qr;
        byId("nestPairDeviceName").textContent = response.name || "Denne telefonen";
        byId("nestPairFingerprint").textContent = groupedFingerprint(response.fingerprint);
        byId("nestPairQrWrap").hidden = false;
        setResult("Venter på at den andre telefonen skanner koden …");
        if (!dialog.open) dialog.showModal();
        refreshIdentity();
      } catch (error) {
        notify(error?.message || error);
      }
    }

    function scanQr() {
      try {
        ensureAutoLocal();
        setResult("Åpner sikker QR-skanner …");
        if (!dialog.open) dialog.showModal();
        window.NativeLocal.scanPairingQr?.();
      } catch (error) {
        notify(error?.message || error);
      }
    }

    show.addEventListener("click", showQr);
    scan.addEventListener("click", scanQr);
    byId("nestPairScanFromDialog").addEventListener("click", scanQr);
    byId("nestPairClose").addEventListener("click", () => dialog.close());
    byId("nestPairPaste").addEventListener("click", () => {
      const raw = window.prompt("Lim inn NESTPAIR1-koden:");
      if (!raw) return;
      try {
        ensureAutoLocal();
        window.NativeLocal.acceptPairingInvite?.(raw);
        setResult("Verifiserer pairingkoden …");
      } catch (error) {
        setResult(error?.message || String(error));
      }
    });
    byId("nestPairCopy").addEventListener("click", async () => {
      if (!currentPayload) return;
      try {
        await navigator.clipboard.writeText(currentPayload);
        notify("Pairingkoden er kopiert. Del den bare direkte med telefonen som skal pares.");
      } catch {
        window.prompt("Kopier pairingkoden:", currentPayload);
      }
    });

    byId("nestForgetPeers").addEventListener("click", () => {
      if (!confirm("Glem alle lokalt parede telefoner? De må skannes på nytt før lokal arbeidsdata kan deles.")) return;
      try {
        window.NativeLocal.clearTrustedPeers?.();
        refreshIdentity();
      } catch (error) {
        notify(error?.message || error);
      }
    });

    window.NestLocalPairing = {
      onScanResult(raw) {
        try {
          ensureAutoLocal();
          window.NativeLocal.acceptPairingInvite?.(String(raw));
          setResult("QR lest. Verifiserer begge telefonene …");
        } catch (error) {
          setResult(error?.message || String(error));
        }
      },
      onScanCanceled() { setResult("Skanning avbrutt."); },
      onScanError(message) { setResult(`QR-skanning feilet: ${message || "ukjent feil"}. Du kan lime inn pairingkoden manuelt.`); },
      onStatus(state, count, detail) {
        trusted.textContent = `${Number(count) || 0} verifiserte`;
        const message = String(detail || state || "");
        setResult(message);
        refreshIdentity();
        if (state === "paired") {
          notify(message || "Telefonene er verifisert og paret.");
          setTimeout(() => { if (dialog.open) dialog.close(); }, 900);
        } else if (["identity_changed", "rejected", "error"].includes(String(state))) {
          notify(message, 7600);
        }
      }
    };

    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    refreshIdentity();
  }

  function improveAuthCopy() {
    const setup = byId("oauthSetup");
    if (!setup || !window.NativeHost) return;
    try {
      const mode = String(window.NativeHost.getGitHubAuthMode?.() || "device");
      if (mode === "pkce") {
        setup.hidden = true;
        const login = byId("githubLoginButton");
        if (login) {
          login.textContent = "Logg inn med GitHub";
          login.title = "Authorization Code + PKCE med appens registrerte OAuth-identitet";
        }
      } else {
        const copy = setup.querySelector("p");
        if (copy) copy.textContent = "Debug/open build: bruk OAuth Client ID og GitHub Device Flow. Produksjonsbygg bruker Authorization Code + PKCE.";
      }
    } catch {}
  }

  function updateVersionCopy() {
    const footer = document.querySelector(".about-footer span");
    if (footer) footer.textContent = "Versjon 0.7.0 · BLCKSWAN";
    const productParagraphs = [...document.querySelectorAll(".about-product-note > p:not(.about-overline):not(.about-positioning)")];
    if (productParagraphs[0]) productParagraphs[0].textContent = "NEST Channel samler betinget oppgavebehandling og to synkveier i én app. GitHub bruker ende-til-ende-krypterte snapshots. Lokalmodus oppdager telefoner automatisk, men sender arbeidsdata først etter QR-verifisert identitetspairing og en flyktig ECDH-sesjon med AES-256-GCM.";
    if (productParagraphs[1]) productParagraphs[1].textContent = "v0.7.0 legger til GitHub Authorization Code + PKCE for registrerte bygg, latest-snapshot bootstrap, Android Keystore-forankret lokal signeringsidentitet og Lamport-klokker som tåler skjeve systemklokker.";
    const localDescription = document.querySelector(".local-mode-panel .mode-description");
    if (localDescription) localDescription.textContent = "Discovery er automatisk. Før arbeidsdata deles, pares telefonene én gang med QR. Deretter verifiseres den permanente identiteten og hver appstart får en ny, flyktig ECDH-sesjonsnøkkel.";
    const localSecurity = document.querySelector(".local-mode-panel .local-security");
    if (localSecurity && !localSecurity.querySelector('[data-v07-trust]')) {
      const trust = document.createElement("span");
      trust.dataset.v07Trust = "true";
      trust.textContent = "QR-verifisert identitet";
      localSecurity.prepend(trust);
    }
  }

  function init() {
    setupPairingUi();
    improveAuthCopy();
    updateVersionCopy();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else setTimeout(init, 0);
})();
