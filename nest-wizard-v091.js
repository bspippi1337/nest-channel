/* NEST Channel 0.9.1 guided two-phone setup. No analytics and no third-party AI key access. */
(() => {
  "use strict";
  window.NEST_WIZARD_091 = true;
  const $ = id => document.getElementById(id);
  const API = "https://api.github.com";
  const DONE = "nest.onboarding.v08.done";
  const NEW_DONE = "nest.onboarding.v091.done";
  const enc = new TextEncoder();
  const state = {
    role: "", step: "welcome", token: "", login: "", repo: "", visibility: "public",
    channel: "", key: "", nickname: "", issue: 0, expires: 0, error: ""
  };
  const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
  const b64url = bytes => {
    let s = "";
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  const native = () => window.NativeHost && typeof window.NativeHost.loadSecret === "function" ? window.NativeHost : null;
  const randKey = () => b64url(randomBytes(32));
  const nick = () => state.nickname.trim() || state.login || "Telefon";
  const validRepo = value => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && value.length < 200;
  const validChannel = value => /^[a-zA-Z0-9._-]{1,48}$/.test(value);
  const canonical = channel => channel.trim().replace(/^#/, "").toLocaleLowerCase("nb");
  const roomHash = async channel => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("nest-room:" + canonical(channel)))));
  const randomChannel = () => "nest-" + hex(randomBytes(5));

  function tag(type, label, cls, parent) {
    const node = document.createElement(type);
    if (label !== undefined) node.textContent = label;
    if (cls) node.className = cls;
    if (parent) parent.append(node);
    return node;
  }
  function button(parent, label, fn, variant) {
    const b = tag("button", label, "nest91-btn " + (variant || ""), parent);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try { await fn(); }
      catch (e) { state.error = String(e?.message || e); render(); }
      finally { b.disabled = false; }
    });
    return b;
  }
  function field(parent, label, name, options = {}) {
    const wrap = tag("label", "", "nest91-field", parent);
    tag("span", label, "", wrap);
    const input = tag("input", "", "", wrap);
    input.type = options.type || "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = options.placeholder || "";
    input.value = state[name] || "";
    input.maxLength = options.maxLength || 256;
    input.addEventListener("input", () => { state[name] = input.value; });
    return input;
  }
  function note(parent, message, type = "") { return tag("p", message, "nest91-note " + type, parent); }
  function openExternal(url) {
    if (!/^https:\/\/(github\.com|chatgpt\.com)(\/|$)/.test(url)) throw new Error("Kun offisielle sider kan åpnes.");
    if (native()?.openExternalUrl) native().openExternalUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }
  function next(step) { state.error = ""; state.step = step; render(); }
  function authToken() { return state.token || String(native()?.loadSecret("github_token") || ""); }
  async function request(path, options = {}) {
    const token = authToken();
    if (!token) throw new Error("Logg inn med GitHub før dette steget.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(API + path, {
        method: options.method || "GET", signal: controller.signal,
        headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28", ...(options.body ? { "Content-Type": "application/json" } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
    } finally { clearTimeout(timer); }
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error("GitHub " + response.status + ": " + (json?.message || "Sjekk tilgang og prøv igjen."));
      error.status = response.status;
      throw error;
    }
    return json;
  }
  async function loginWithToken(raw) {
    const candidate = String(raw || "").trim();
    if (!/^(github_pat_|gh[pousr]_|ghu_)/.test(candidate)) throw new Error("Ugyldig tokenformat.");
    state.token = candidate;
    try {
      const info = await request("/user");
      state.login = info.login || "";
      if (!state.login) throw new Error("GitHub returnerte ikke brukernavn.");
      native()?.saveSecret("github_token", candidate);
      next(state.role === "host" ? "repository" : "access");
    } catch (error) {
      state.token = "";
      throw error;
    }
  }
  async function continueWithSavedAuth() {
    const info = await request("/user");
    state.login = info.login || "";
    if (!state.login) throw new Error("GitHub-identiteten er ikke verifisert.");
    next(state.role === "host" ? "repository" : "access");
  }
  function inviteData() {
    if (!validRepo(state.repo) || !validChannel(state.channel) || !state.issue || !/^[A-Za-z0-9_-]{43}$/.test(state.key)) {
      throw new Error("Kanalen er ikke ferdig konfigurert.");
    }
    state.expires = Date.now() + 30 * 60 * 1000;
    return "NESTINV1." + b64url(enc.encode(JSON.stringify({
      v: 1, repo: state.repo, channel: canonical(state.channel), secret: state.key, issue: state.issue, expires: state.expires
    })));
  }
  function parseInvite(raw) {
    if (typeof raw !== "string" || !raw.startsWith("NESTINV1.") || raw.length > 1200) {
      throw new Error("Dette er ikke en NEST 0.9.1-invitasjon.");
    }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromB64url(raw.slice(9))));
    if (data.v !== 1 || !validRepo(data.repo) || !validChannel(data.channel)
        || !/^[A-Za-z0-9_-]{43}$/.test(data.secret)
        || !Number.isSafeInteger(data.issue) || data.issue < 1
        || !Number.isFinite(data.expires) || data.expires < Date.now() || data.expires > Date.now() + 31 * 60 * 1000) {
      throw new Error("Invitasjonen er feil, utløpt eller endret. Be om en ny QR.");
    }
    state.repo = data.repo; state.channel = data.channel; state.key = data.secret;
    state.issue = data.issue; state.expires = data.expires;
    state.role = "join";
    next("account");
  }
  async function verifyRepo() {
    if (!validRepo(state.repo)) throw new Error("Repo må skrives som eier/navn.");
    const [owner, repo] = state.repo.split("/");
    const data = await request("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo));
    if (!data.has_issues) throw new Error("Dette repoet har Issues deaktivert.");
    state.visibility = data.private ? "private" : "public";
    return data;
  }
  async function createRepo() {
    const name = "nest-" + hex(randomBytes(5));
    const data = await request("/user/repos", { method: "POST", body: {
      name, description: "NEST encrypted transport", private: state.visibility === "private",
      has_issues: true, has_wiki: false, has_projects: false, auto_init: false
    } });
    if (!data.full_name || !!data.private !== (state.visibility === "private"))
      throw new Error("GitHub bekreftet ikke ønsket synlighet.");
    state.repo = data.full_name;
    state.channel ||= randomChannel();
    state.key ||= randKey();
    next("channel");
  }
  function cacheIssue(room) {
    window.localStorage.setItem("nest.github.issue.v1:" + state.repo + ":" + room, String(state.issue));
  }
  async function findOrCreateIssue() {
    const hash = await roomHash(state.channel);
    const marker = "<!-- NEST-ROOM:" + hash + " -->";
    const [owner, repo] = state.repo.split("/");
    const root = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
    for (let page = 1; page <= 3; page++) {
      const issues = await request(root + "/issues?state=open&per_page=100&page=" + page);
      const item = issues.find(x => !x.pull_request && String(x.body || "").includes(marker));
      if (item) { state.issue = item.number; cacheIssue(hash); return; }
      if (issues.length < 100) break;
    }
    const created = await request(root + "/issues", { method: "POST", body: {
      title: "[NEST SYNC] " + hash.slice(0, 12),
      body: marker + "\n\nEncrypted NEST sync. No plaintext or keys."
    } });
    if (!created.number) throw new Error("GitHub opprettet ikke kanal-Issue.");
    state.issue = created.number;
    cacheIssue(hash);
  }
  async function validateIssue() {
    const [owner, repo] = state.repo.split("/");
    const issue = await request("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/issues/" + state.issue);
    const hash = await roomHash(state.channel);
    if (issue.state !== "open" || !String(issue.body || "").includes("<!-- NEST-ROOM:" + hash + " -->")) {
      throw new Error("Invitasjonen peker på feil eller stengt kanal.");
    }
    cacheIssue(hash);
  }
  async function encryptedRoundTrip() {
    const hash = await roomHash(state.channel);
    const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("nest-key:" + hash))).slice(0, 16);
    const material = await crypto.subtle.importKey("raw", enc.encode(state.key), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 }, material,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = randomBytes(12);
    const payload = { kind: "handshake", nonce: hex(randomBytes(16)), client: "wizard091" };
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(hash) }, key, enc.encode(JSON.stringify(payload))));
    const envelope = { v: 2, kind: "handshake", room: hash, id: crypto.randomUUID(), part: 1, total: 1,
      iv: b64url(iv), data: b64url(ciphertext) };
    // The existing protocol uses standard Base64 for IV/data.
    const standard = bytes => {
      let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s);
    };
    envelope.iv = standard(iv); envelope.data = standard(ciphertext);
    const [owner, repo] = state.repo.split("/");
    const root = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
    const created = await request(root + "/issues/" + state.issue + "/comments", {
      method: "POST", body: { body: "<!-- NEST-E2EE-V1 -->\n" + JSON.stringify(envelope) }
    });
    if (!created.id) throw new Error("GitHub bekreftet ikke at kryptert test ble sendt.");
    const readBack = await request(root + "/issues/comments/" + created.id);
    const actual = JSON.parse(String(readBack.body || "").replace(/^<!-- NEST-E2EE-V1 -->\s*/, ""));
    if (actual.id !== envelope.id || actual.room !== hash) throw new Error("Kryptert test ble endret underveis.");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(actual.iv.replace(/\+/g, "-").replace(/\//g, "_")),
        additionalData: enc.encode(hash) }, key, fromB64url(actual.data.replace(/\+/g, "-").replace(/\//g, "_")));
    if (JSON.parse(new TextDecoder().decode(plaintext)).nonce !== payload.nonce)
      throw new Error("Integritetstest feilet.");
    return true;
  }
  async function finish() {
    if (!native()) throw new Error("Sikker nøkkellagring krever NEST Android-appen.");
    if (!state.login || !validRepo(state.repo) || !validChannel(state.channel)
        || !/^[A-Za-z0-9_-]{43}$/.test(state.key)) throw new Error("Oppsettet mangler identitet, kanal eller nøkkel.");
    await verifyRepo();
    await validateIssue();
    await encryptedRoundTrip();
    const hash = await roomHash(state.channel);
    native().saveSecret("channel_password", state.key);
    if (native().loadSecret("channel_password") !== state.key) throw new Error("Android kunne ikke lagre kanalnøkkelen.");
    localStorage.setItem("nest.channel.storage.namespace", "." + hash);
    localStorage.setItem("nest.channel.settings.v1", JSON.stringify({
      relayUrl: state.repo, channelName: state.channel, nickname: nick()
    }));
    localStorage.setItem("nest.sync.mode.v1", "github");
    native().setSyncMode?.("github");
    localStorage.setItem(DONE, "1");
    localStorage.setItem(NEW_DONE, "1");
    next("ready");
  }
  async function inviteCollaborator() {
    const username = String($("nest91-partner")?.value || "").trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username)) {
      throw new Error("Skriv partnerens GitHub-brukernavn.");
    }
    if (username.toLowerCase() === state.login.toLowerCase()) throw new Error("Velg den andre brukerens konto.");
    const [owner, repo] = state.repo.split("/");
    await request("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/collaborators/" + encodeURIComponent(username),
      { method: "PUT", body: { permission: "push" } });
    state.error = "Invitasjon sendt. Den andre brukeren må godkjenne under GitHub-varsler.";
    render();
  }
  async function copyInvite() {
    const raw = inviteData();
    try { await navigator.clipboard.writeText(raw); state.error = "Engangsoverføring kopiert. Send aldri koden i et offentlig repo."; }
    catch { window.prompt("Kopier privat til den andre telefonen:", raw); }
    render();
  }
  function supportQuestion() {
    const lines = [
      "Hjelp meg med NEST Channel 0.9.1 Android-oppsett på norsk.",
      "Steg: " + state.step + ". Rolle: " + (state.role || "ikke valgt") + ".",
      "GitHub-transport med AES-256-GCM og privat nøkkel kun på Android.",
      "Repo-type: " + state.visibility + ".",
      "Gi korte, konkrete steg. Ikke be om konto-passord, token eller kanalnøkkel.",
      "Ta hensyn til at jeg ikke bruker PC. GitHub-konto og CAPTCHA gjøres manuelt."
    ];
    return lines.join("\n");
  }
  async function aiHelp() {
    const prompt = supportQuestion();
    try { await navigator.clipboard.writeText(prompt); state.error = "Nøkkelfri hjelpebeskrivelse kopiert. Lim inn i valgfri AI-assistent."; }
    catch { window.prompt("Kopier hjelpebeskrivelse:", prompt); }
    render();
    openExternal("https://chatgpt.com/");
  }
  function render() {
    const dialog = $("nest91-dialog");
    if (!dialog) return;
    const body = $("nest91-body"); body.replaceChildren();
    $("nest91-title").textContent = ({
      welcome: "To telefoner. Én kryptert kanal.", account: "GitHub-konto på telefonen",
      auth: "Koble GitHub til NEST", repository: "Velg transportlager",
      channel: "Opprett kryptert kanal", invite: "Inviter telefon nummer to",
      import: "Skann invitasjonen", access: "Kontroller GitHub-tilgang",
      ready: "Kanal verifisert"
    })[state.step] || "NEST 0.9.1";
    tag("p", "NEST · 0.9.1 · " + (state.role === "host" ? "Telefon A" : state.role === "join" ? "Telefon B" : "Velkommen"), "nest91-kicker", body);
    if (state.error) note(body, state.error, "error");
    if (state.step === "welcome") {
      note(body, "Ingen laptop. GitHub er transport, telefonene eier nøkkelen. Offentlige repoer kan brukes, men metadata er offentlige.");
      button(body, "Telefon A · Opprett kanal", () => { state.role = "host"; state.channel ||= randomChannel(); state.key ||= randKey(); next("account"); }, "primary");
      button(body, "Telefon B · Bli med", () => { state.role = "join"; next("import"); });
      button(body, "Bruk NEST lokalt uten GitHub", () => { native()?.setSyncMode?.("local"); localStorage.setItem("nest.sync.mode.v1", "local"); dialog.close(); });
      return;
    }
    if (state.step === "import") {
      note(body, "Skann QR fra telefon A, eller lim inn en kortvarig invitasjonskode. Koden inneholder kanalnøkkelen og må aldri deles offentlig.");
      field(body, "NESTINV1-kode", "pendingInvite", { placeholder: "NESTINV1....", maxLength: 1200 });
      button(body, "Kontroller invitasjonen", () => parseInvite(state.pendingInvite || ""), "primary");
      button(body, "Skann QR-kode", () => {
        if (!native()?.scanInviteQr) throw new Error("QR-skanning krever Android-APK med NEST 0.9.1.");
        native().scanInviteQr();
      });
      button(body, "Tilbake", () => next("welcome"), "ghost");
      return;
    }
    if (state.step === "account") {
      note(body, "Har du allerede GitHub-konto, gå videre. Ellers oppretter du en på GitHub. Kontoen og e-postbekreftelsen håndteres av GitHub, ikke NEST.");
      button(body, "Opprett GitHub-konto", () => openExternal("https://github.com/signup"));
      button(body, "Jeg har konto / er ferdig", () => next("auth"), "primary");
      button(body, "Tilbake", () => next(state.role === "host" ? "welcome" : "import"), "ghost");
      return;
    }
    if (state.step === "auth") {
      note(body, "Bruk GitHub-innlogging i NEST. Hvis bygget mangler OAuth-oppsett, kan du bruke en personlig tilgangsnøkkel. Ikke del denne med den andre telefonen.");
      const login = tag("p", "", "nest91-note", body);
      login.textContent = authToken() ? "En GitHub-innlogging er tilgjengelig." : "Ikke logget inn.";
      button(body, "Bruk eksisterende innlogging", continueWithSavedAuth, "primary");
      button(body, "Logg inn via GitHub", () => { $("githubLoginButton")?.click(); state.error = "Godkjenn GitHub. Kom tilbake og trykk «Bruk eksisterende innlogging»."; render(); });
      const tokenField = field(body, "Alternativ: tilgangsnøkkel (bare på denne telefonen)", "manualToken", { type: "password", maxLength: 300 });
      button(body, "Kontroller tilgangsnøkkel", () => loginWithToken(tokenField.value), "primary");
      button(body, "GitHub: ny fine-grained nøkkel", () => openExternal("https://github.com/settings/personal-access-tokens/new?name=NEST%20Channel&expires_in=30&administration=write&issues=write"));
      if (state.role === "join" && state.visibility === "public")
        button(body, "Alternativ for offentlig repo: classic public_repo", () => openExternal("https://github.com/settings/tokens/new?scopes=public_repo&description=NEST%20Channel"));
      note(body, "Tilgangsnøkler kan gi bredere GitHub-tilgang enn NEST trenger. OAuth er å foretrekke når tilgjengelig.");
      return;
    }
    if (state.step === "repository") {
      note(body, "Et offentlig repo fungerer fordi alle meldinger krypteres før opplasting. GitHub kan fortsatt se tidspunkt, kontoer og mengde trafikk.");
      const select = tag("select", "", "nest91-select", body);
      [["public", "Offentlig repo · enklest for to"], ["private", "Privat repo · krever GitHub-invitasjon"]].forEach(([value, label]) => {
        const o = tag("option", label, "", select); o.value = value;
      });
      select.value = state.visibility;
      select.onchange = () => { state.visibility = select.value; };
      button(body, "Opprett nytt repo på GitHub", createRepo, "primary");
      field(body, "Eller bruk eksisterende repo (eier/navn)", "repo", { placeholder: "githubbruker/nest-data" });
      button(body, "Kontroller eksisterende repo", async () => {
        await verifyRepo(); state.channel ||= randomChannel(); state.key ||= randKey(); next("channel");
      });
      return;
    }
    if (state.step === "channel") {
      note(body, "NEST lager en tilfeldig 256-bits nøkkel. Ikke velg et kort passord. Kanalnavn må bestå av bokstaver, tall, punktum, bindestrek eller understrek.");
      field(body, "Kanalnavn", "channel", { maxLength: 48 });
      field(body, "Ditt kallenavn", "nickname", { maxLength: 32, placeholder: state.login });
      note(body, "Nøkkelen vises ikke på GitHub. Den overføres kun gjennom QR eller en privat invitasjonskode.");
      button(body, "Opprett og test kanalen", async () => {
        if (!validChannel(state.channel)) throw new Error("Ugyldig kanalnavn.");
        await verifyRepo(); await findOrCreateIssue(); await encryptedRoundTrip(); next("invite");
      }, "primary");
      return;
    }
    if (state.step === "invite") {
      note(body, "Klar på telefon A. Åpne NEST på telefon B samtidig, velg «Bli med», og skann QR-koden under.");
      note(body, state.repo + " · " + state.visibility + " · Issue #" + state.issue);
      const raw = inviteData();
      const image = tag("img", "", "nest91-qr", body);
      image.alt = "QR-kode som inneholder hemmelig kanalnøkkel. Vis bare til mottakeren.";
      if (native()?.makeQrCode) {
        try { image.src = native().makeQrCode(raw); } catch { image.hidden = true; }
      } else image.hidden = true;
      button(body, "Kopier privat invitasjonskode", copyInvite);
      button(body, "Lag ny QR med ny utløpstid", () => render());
      if (state.visibility === "private") {
        note(body, "Privat repo krever at partnerens GitHub-konto får tilgang. Inviter før telefon B tester kanalen.");
        const input = tag("input", "", "nest91-input", body); input.id = "nest91-partner"; input.placeholder = "GitHub-brukernavn til telefon B";
        button(body, "Send GitHub-invitasjon", inviteCollaborator);
      }
      button(body, "Kontroller og start på telefon A", finish, "primary");
      return;
    }
    if (state.step === "access") {
      note(body, "Telefon B kontrollerer at GitHub-kontoen kan lese riktig kanal og publisere en kryptert test. Ingen åpen melding sendes.");
      field(body, "Ditt kallenavn", "nickname", { maxLength: 32 });
      note(body, "Mål: " + state.repo + " · " + state.visibility);
      button(body, "Test og aktiver kanal", finish, "primary");
      button(body, "Godkjenn eventuell privat invitasjon", () => openExternal("https://github.com/notifications"));
      return;
    }
    if (state.step === "ready") {
      tag("div", "✓", "nest91-success", body);
      note(body, "E2EE-testen ble skrevet til GitHub, lest tilbake og dekryptert på denne telefonen. NEST har lagret nøkkelen i Android Keystore-beskyttet lagring.");
      note(body, "Dette beviser funksjon for én telefon, ikke sikkerhet mot kompromitterte telefoner, metadata-lekkasje eller framtidig GitHub-nedetid.");
      button(body, "Åpne kanalen", () => location.reload(), "primary");
    }
  }
  function openWizard(step) {
    if (step) state.step = step;
    state.error = ""; render();
    const dialog = $("nest91-dialog");
    if (!dialog.open) dialog.showModal();
  }
  function init() {
    if ($("nest91-dialog")) return;
    const launcher = tag("button", "Oppsett 0.9.1", "nest91-launch", document.querySelector(".topbar-actions") || document.body);
    launcher.type = "button"; launcher.onclick = () => openWizard("welcome");
    const dialog = tag("dialog", "", "nest91-dialog", document.body); dialog.id = "nest91-dialog";
    const article = tag("article", "", "nest91-content", dialog);
    const head = tag("header", "", "nest91-head", article);
    tag("h2", "NEST 0.9.1", "", head).id = "nest91-title";
    button(head, "×", () => dialog.close(), "close");
    tag("section", "", "nest91-body", article).id = "nest91-body";
    const footer = tag("footer", "", "nest91-footer", article);
    button(footer, "Valgfri AI-hjelp · uten hemmeligheter", aiHelp, "ghost");
    if (localStorage.getItem(NEW_DONE) !== "1" && localStorage.getItem(DONE) !== "1")
      setTimeout(() => openWizard("welcome"), 300);
  }
  window.NestWizard091 = {
    onScan(raw) { try { parseInvite(String(raw)); openWizard(); } catch (e) { state.error = String(e.message || e); openWizard("import"); } },
    open: () => openWizard("welcome"),
    // Pure helpers exposed for deterministic test harnesses only.
    parseInvite, inviteData, validRepo, validChannel
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
