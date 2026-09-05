(() => {
  "use strict";

  const DONE_KEY = "nest.onboarding.v08.done";
  const SETTINGS_KEY = "nest.channel.settings.v1";
  const MODE_KEY = "nest.sync.mode.v1";
  const NS_KEY = "nest.channel.storage.namespace";
  const API = "https://api.github.com";
  const API_VERSION = "2022-11-28";
  const SIGNUP_URL = "https://github.com/signup";
  const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new?name=NEST%20Channel&description=Encrypted%20NEST%20Channel%20sync%20storage&expires_in=90&administration=write&issues=write";

  const byId = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const state = {
    step: 0,
    token: "",
    login: "",
    repo: "",
    repoUrl: "",
    busy: false
  };

  function nativeHost() {
    return window.NativeHost && typeof window.NativeHost === "object" ? window.NativeHost : null;
  }

  function secretLoad(key) {
    try { return String(nativeHost()?.loadSecret?.(key) || ""); } catch { return ""; }
  }

  function secretSave(key, value) {
    try { nativeHost()?.saveSecret?.(key, String(value)); } catch {}
  }

  function secretDelete(key) {
    try { nativeHost()?.deleteSecret?.(key); } catch {}
  }

  function openExternal(url) {
    try {
      nativeHost()?.openExternalUrl?.(url);
      return;
    } catch {}
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function copy(text, success = "Kopiert") {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      flash(success);
      return true;
    } catch {
      window.prompt("Kopier:", String(text || ""));
      return false;
    }
  }

  function flash(message, type = "ok") {
    const node = byId("nestOnboardFlash");
    if (!node) return;
    node.textContent = String(message || "");
    node.dataset.type = type;
    node.classList.add("shown");
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => node.classList.remove("shown"), 3400);
  }

  function randomHex(bytes = 4) {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    return [...data].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function randomSecret(bytes = 18) {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    let binary = "";
    data.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function githubRequest(path, options = {}, tokenOverride = "") {
    const token = tokenOverride || state.token || secretLoad("github_token");
    if (!token) throw new Error("GitHub-nøkkelen mangler.");
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.message ? ` · ${body.message}` : "";
      const error = new Error(`GitHub svarte ${response.status}${detail}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function validateToken(raw) {
    const candidate = String(raw || "").trim();
    if (!candidate) throw new Error("Lim inn GitHub-nøkkelen først.");
    const user = await githubRequest("/user", {}, candidate);
    state.token = candidate;
    state.login = String(user?.login || "");
    secretSave("github_token", candidate);
    return user;
  }

  function safeRepoName(value) {
    const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || `nest-${randomHex(4)}`;
  }

  async function createPrivateRepo(preferredName) {
    const base = safeRepoName(preferredName);
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const name = attempt === 0 ? base : `${base}-${randomHex(2)}`;
      try {
        const repo = await githubRequest("/user/repos", {
          method: "POST",
          body: JSON.stringify({
            name,
            description: "Encrypted NEST Channel sync storage",
            private: true,
            has_issues: true,
            has_projects: false,
            has_wiki: false,
            auto_init: false
          })
        });
        state.repo = String(repo?.full_name || "");
        state.repoUrl = String(repo?.html_url || "");
        return repo;
      } catch (error) {
        lastError = error;
        if (error?.status !== 422) throw error;
      }
    }
    throw lastError || new Error("Kunne ikke finne et ledig repo-navn.");
  }

  async function roomNamespace(channel) {
    const normalized = String(channel || "").trim().replace(/^#/, "").toLocaleLowerCase("nb");
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nest-room:${normalized}`)));
    return `.${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async function finishCloudSetup() {
    const nickname = byId("nestOnboardNickname")?.value.trim() || "Telefon";
    const channel = byId("nestOnboardChannel")?.value.trim().replace(/^#/, "") || "nest";
    const password = byId("nestOnboardPassword")?.value.trim() || randomSecret();
    if (!state.repo) throw new Error("Privat NEST-lager er ikke opprettet ennå.");
    if (password.length < 8) throw new Error("Kanalnøkkelen må ha minst 8 tegn.");

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ relayUrl: state.repo, channelName: channel, nickname }));
    localStorage.setItem(MODE_KEY, "auto");
    localStorage.setItem(NS_KEY, await roomNamespace(channel));
    localStorage.setItem(DONE_KEY, "1");
    secretSave("channel_password", password);
    try { nativeHost()?.setSyncMode?.("auto"); } catch {}

    byId("relayUrl").value = state.repo;
    byId("channelName").value = channel;
    byId("nickname").value = nickname;
    byId("channelPassword").value = password;

    state.step = 5;
    render();
    setTimeout(() => location.reload(), 1200);
  }

  function hasPkce() {
    try { return String(nativeHost()?.getGitHubAuthMode?.() || "device") === "pkce"; }
    catch { return false; }
  }

  async function waitForStoredOAuthToken(timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const token = secretLoad("github_token");
      if (token) {
        try {
          await validateToken(token);
          return true;
        } catch {}
      }
      await sleep(1200);
    }
    return false;
  }

  function setupLauncher() {
    if (byId("nestOnboardLauncher")) return;
    const button = document.createElement("button");
    button.id = "nestOnboardLauncher";
    button.type = "button";
    button.className = "nest-onboard-launcher";
    button.textContent = localStorage.getItem(DONE_KEY) === "1" ? "Oppsett" : "Kom i gang";
    button.addEventListener("click", () => openWizard(localStorage.getItem(DONE_KEY) === "1" ? 4 : 0));
    document.querySelector(".topbar-actions")?.append(button);
  }

  function createWizard() {
    if (byId("nestOnboardDialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "nestOnboardDialog";
    dialog.className = "nest-onboard-dialog";
    dialog.innerHTML = `
      <article class="nest-onboard-shell">
        <header class="nest-onboard-head">
          <div>
            <p class="nest-onboard-kicker">NEST ZERO-SETUP · v0.8</p>
            <h2 id="nestOnboardTitle">Kom i gang uten GitHub-prat.</h2>
          </div>
          <button id="nestOnboardClose" class="nest-onboard-close" type="button" aria-label="Lukk">×</button>
        </header>
        <div class="nest-onboard-progress" aria-label="Oppsettsfremdrift">
          <i></i><i></i><i></i><i></i><i></i>
        </div>
        <section id="nestOnboardBody" class="nest-onboard-body"></section>
        <div id="nestOnboardFlash" class="nest-onboard-flash" aria-live="polite"></div>
      </article>
    `;
    document.body.append(dialog);
    byId("nestOnboardClose").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  }

  function openWizard(step = 0) {
    createWizard();
    state.step = Math.max(0, Math.min(5, Number(step) || 0));
    const existingToken = secretLoad("github_token");
    if (existingToken) state.token = existingToken;
    render();
    const dialog = byId("nestOnboardDialog");
    if (dialog && !dialog.open) dialog.showModal();
  }

  function setProgress(active) {
    document.querySelectorAll(".nest-onboard-progress i").forEach((node, index) => {
      node.classList.toggle("done", index < active);
      node.classList.toggle("active", index === active);
    });
  }

  function arrowButton(label, id, extra = "") {
    return `<button id="${id}" class="nest-next ${extra}" type="button"><span>${label}</span><b aria-hidden="true">→</b></button>`;
  }

  function render() {
    const body = byId("nestOnboardBody");
    if (!body) return;
    setProgress(Math.min(state.step, 4));

    if (state.step === 0) {
      byId("nestOnboardTitle").textContent = "Kom i gang uten GitHub-prat.";
      body.innerHTML = `
        <div class="nest-hero-mark"><span>N</span></div>
        <h3>Hva vil du at NEST skal gjøre?</h3>
        <p class="nest-onboard-lead">Velg bare hvor arbeidsdata skal leve. Resten ordner veiviseren.</p>
        <div class="nest-choice-grid">
          <button id="nestCloudStart" class="nest-choice recommended" type="button"><small>ANBEFALT</small><strong>Synk mellom telefoner</strong><span>Privat GitHub-lager + lokal P2P. NEST setter opp motorrommet.</span><b>→</b></button>
          <button id="nestLocalStart" class="nest-choice" type="button"><small>UTEN SKY</small><strong>Bare lokalt</strong><span>Ingen GitHub. Pair telefoner med QR når du trenger det.</span><b>→</b></button>
        </div>
        <button id="nestAdvancedSetup" class="nest-link-button" type="button">Jeg vet hva repo/OAuth betyr · vis avansert</button>
      `;
      byId("nestCloudStart").onclick = () => {
        localStorage.setItem(MODE_KEY, "auto");
        try { nativeHost()?.setSyncMode?.("auto"); } catch {}
        state.step = 1; render();
      };
      byId("nestLocalStart").onclick = () => {
        localStorage.setItem(MODE_KEY, "local");
        localStorage.setItem(DONE_KEY, "1");
        try { nativeHost()?.setSyncMode?.("local"); } catch {}
        location.reload();
      };
      byId("nestAdvancedSetup").onclick = () => {
        byId("nestOnboardDialog")?.close();
        const sync = byId("syncSettings");
        if (sync) sync.open = true;
        document.querySelector(".connect-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      return;
    }

    if (state.step === 1) {
      byId("nestOnboardTitle").textContent = "1 · GitHub-identitet";
      body.innerHTML = `
        <div class="nest-step-number">01</div>
        <h3>Har du allerede en GitHub-konto?</h3>
        <p class="nest-onboard-lead">Hvis ikke, kan du lage en separat pseudonym konto. GitHub gjør CAPTCHA og e-postverifisering selv. NEST lagrer ikke e-postadressen.</p>
        <label class="nest-big-label">E-post til ny konto <span>kun for kopiering</span>
          <input id="nestSignupEmail" type="email" autocomplete="off" placeholder="din-alias@epost.no">
        </label>
        <div class="nest-human-step">
          <b>MENNESKESTEG</b>
          <span>1. Vi kopierer e-posten → 2. GitHub åpnes → 3. Fullfør CAPTCHA + verifisering → 4. Kom tilbake hit.</span>
        </div>
        ${arrowButton("Åpne GitHub signup", "nestOpenSignup")}
        ${arrowButton("Jeg har konto / er ferdig", "nestAccountDone", "secondary")}
        <p class="nest-privacy-note">NEST forsøker ikke å omgå CAPTCHA eller GitHubs anti-bot-kontroller.</p>
      `;
      byId("nestOpenSignup").onclick = async () => {
        const email = byId("nestSignupEmail")?.value.trim();
        if (email) await copy(email, "E-post kopiert. Lim den inn i GitHub-feltet →");
        openExternal(SIGNUP_URL);
      };
      byId("nestAccountDone").onclick = () => { state.step = 2; render(); };
      return;
    }

    if (state.step === 2) {
      byId("nestOnboardTitle").textContent = "2 · Gi NEST en nøkkel";
      const pkce = hasPkce();
      body.innerHTML = `
        <div class="nest-step-number">02</div>
        <h3>${pkce ? "Logg inn. NEST tar resten." : "Lag én nøkkel. GitHub fyller ut nesten alt."}</h3>
        <p class="nest-onboard-lead">${pkce ? "Dette bygget har registrert GitHub-innlogging med PKCE." : "Denne åpne builden har ingen innebygd GitHub-identitet. Vi bruker derfor GitHubs offisielle fine-grained token-skjema med navn, utløp og permissions ferdig utfylt."}</p>
        ${pkce ? `
          <div class="nest-permission-card"><span>GitHub OAuth + PKCE</span><strong>Ingen token-pasting</strong><small>NEST venter på at GitHub sender deg tilbake.</small></div>
          ${arrowButton("Logg inn med GitHub", "nestPkceLogin")}
        ` : `
          <div class="nest-permission-card"><span>FORHÅNDSUTFYLT</span><strong>Administration · write</strong><strong>Issues · write</strong><small>Velg «All repositories» på GitHub-siden slik at nøkkelen også gjelder lageret NEST oppretter straks etterpå.</small></div>
          ${arrowButton("Åpne ferdig utfylt nøkkelside", "nestOpenToken")}
          <label class="nest-big-label">Lim inn nøkkelen fra GitHub
            <input id="nestTokenPaste" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…">
          </label>
          ${arrowButton("Test nøkkel og fortsett", "nestValidateToken")}
        `}
        <button id="nestTokenBack" class="nest-link-button" type="button">← Tilbake</button>
      `;
      byId("nestTokenBack").onclick = () => { state.step = 1; render(); };
      if (pkce) {
        byId("nestPkceLogin").onclick = async () => {
          if (state.busy) return;
          state.busy = true;
          const button = byId("nestPkceLogin");
          button.querySelector("span").textContent = "Venter på GitHub …";
          byId("githubLoginButton")?.click();
          const ok = await waitForStoredOAuthToken();
          state.busy = false;
          if (!ok) {
            button.querySelector("span").textContent = "Logg inn med GitHub";
            flash("Fant ikke ferdig GitHub-innlogging. Prøv igjen.", "error");
            return;
          }
          state.step = 3; render();
        };
      } else {
        byId("nestOpenToken").onclick = () => openExternal(TOKEN_URL);
        byId("nestValidateToken").onclick = async () => {
          if (state.busy) return;
          state.busy = true;
          const button = byId("nestValidateToken");
          button.disabled = true;
          button.querySelector("span").textContent = "Tester mot GitHub …";
          try {
            const user = await validateToken(byId("nestTokenPaste")?.value);
            flash(`Godkjent som @${user.login}`);
            state.step = 3;
            render();
          } catch (error) {
            flash(error?.message || String(error), "error");
            button.disabled = false;
            button.querySelector("span").textContent = "Test nøkkel og fortsett";
          } finally {
            state.busy = false;
          }
        };
      }
      return;
    }

    if (state.step === 3) {
      byId("nestOnboardTitle").textContent = "3 · Privat NEST-lager";
      const suggested = `nest-${randomHex(4)}`;
      body.innerHTML = `
        <div class="nest-step-number">03</div>
        <h3>Repoet skal være usynlig i hverdagen.</h3>
        <p class="nest-onboard-lead">NEST oppretter et tilfeldig navngitt, privat GitHub-repo med Issues aktivert. Ingen kanalnavn eller personnavn trenger stå i repo-navnet.</p>
        <label class="nest-big-label">Lager-navn <span>kan endres</span>
          <input id="nestRepoName" value="${suggested}" maxlength="80" autocomplete="off">
        </label>
        <div class="nest-lock-row"><span>🔒</span><div><strong>Privat er tvunget på</strong><small>Kun den GitHub-identiteten du bruker får tilgang med mindre du inviterer andre.</small></div></div>
        ${arrowButton("Opprett privat lager", "nestCreateRepo")}
        <button id="nestRepoBack" class="nest-link-button" type="button">← Tilbake</button>
      `;
      byId("nestRepoBack").onclick = () => { state.step = 2; render(); };
      byId("nestCreateRepo").onclick = async () => {
        if (state.busy) return;
        state.busy = true;
        const button = byId("nestCreateRepo");
        button.disabled = true;
        button.querySelector("span").textContent = "Bygger privat lager …";
        try {
          const repo = await createPrivateRepo(byId("nestRepoName")?.value);
          flash(`Opprettet ${repo.full_name}`);
          state.step = 4;
          render();
        } catch (error) {
          const hint = error?.status === 403 ? " Nøkkelen trenger Administration: write og tilgang til alle repositories." : "";
          flash(`${error?.message || error}${hint}`, "error");
          button.disabled = false;
          button.querySelector("span").textContent = "Opprett privat lager";
        } finally {
          state.busy = false;
        }
      };
      return;
    }

    if (state.step === 4) {
      byId("nestOnboardTitle").textContent = "4 · Din kanal";
      const generated = randomSecret();
      body.innerHTML = `
        <div class="nest-step-number">04</div>
        <h3>Gi kanalen et menneskelig navn.</h3>
        <p class="nest-onboard-lead">Repoet er motorrommet. Dette er det du faktisk ser og bruker.</p>
        <div class="nest-two-fields">
          <label class="nest-big-label">Kallenavn
            <input id="nestOnboardNickname" maxlength="32" placeholder="Pippi" autocomplete="nickname">
          </label>
          <label class="nest-big-label">Kanal
            <input id="nestOnboardChannel" maxlength="48" value="nest" placeholder="verksted">
          </label>
        </div>
        <label class="nest-big-label">Kanalnøkkel <span>generert lokalt</span>
          <div class="nest-secret-field"><input id="nestOnboardPassword" value="${generated}" autocomplete="off" spellcheck="false"><button id="nestCopySecret" type="button">Kopier</button></div>
        </label>
        <div class="nest-human-step safe"><b>BEHOLD DENNE</b><span>Kanalnøkkelen dekrypterer synken. GitHub får bare kryptert innhold. Del nøkkelen privat med telefoner som skal inn i samme kanal.</span></div>
        ${arrowButton("Start NEST", "nestFinishSetup")}
        <button id="nestChannelBack" class="nest-link-button" type="button">← Tilbake</button>
      `;
      byId("nestChannelBack").onclick = () => { state.step = 3; render(); };
      byId("nestCopySecret").onclick = () => copy(byId("nestOnboardPassword")?.value, "Kanalnøkkel kopiert");
      byId("nestFinishSetup").onclick = async () => {
        if (state.busy) return;
        state.busy = true;
        const button = byId("nestFinishSetup");
        button.disabled = true;
        button.querySelector("span").textContent = "Kobler sammen alt …";
        try { await finishCloudSetup(); }
        catch (error) {
          flash(error?.message || String(error), "error");
          button.disabled = false;
          button.querySelector("span").textContent = "Start NEST";
          state.busy = false;
        }
      };
      return;
    }

    byId("nestOnboardTitle").textContent = "Klar.";
    body.innerHTML = `
      <div class="nest-success-orbit"><span>✓</span></div>
      <h3>NEST har koblet sammen motorrommet.</h3>
      <p class="nest-onboard-lead">Privat repo, GitHub-nøkkel, kryptert kanal og lokal identitet er satt opp. Appen starter på nytt og kobler til automatisk.</p>
      <div class="nest-finish-list"><span>✓ Privat GitHub-lager</span><span>✓ Kryptert kanal</span><span>✓ Sikker nøkkel lagret på telefonen</span><span>✓ Auto-synk aktivert</span></div>
    `;
  }

  function updateVersionCopy() {
    const footer = document.querySelector(".about-footer span");
    if (footer) footer.textContent = "Versjon 0.8.0 · BLCKSWAN";
    const product = [...document.querySelectorAll(".about-product-note > p:not(.about-overline):not(.about-positioning)")];
    if (product[1]) product[1].textContent = "v0.8.0 legger til Zero-Setup: menneskesteg bare der GitHub krever dem, resten automatiseres av NEST.";
  }

  function init() {
    setupLauncher();
    createWizard();
    updateVersionCopy();
    if (localStorage.getItem(DONE_KEY) !== "1") setTimeout(() => openWizard(0), 420);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
