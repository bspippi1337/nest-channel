const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("risk-reduction gates deny by default and require explicit downgrade", () => {
  const p = require("../high-threat.js");
  assert.equal(p.isStrict(), true);
  assert.throws(() => p.requirePrivateRepo({private:false}), /privat/i);
  assert.doesNotThrow(() => p.requirePrivateRepo({private:true}));
  assert.throws(() => p.requireStrongChannelKey("password123"), /256-bits/);
  assert.throws(() => p.requireStrongChannelKey("a".repeat(43)), /256-bits/);
  assert.doesNotThrow(() => p.requireStrongChannelKey("2A7bc8DE9fG0hJKlM1nOPqR3sT4uVW5xYz_-6B8dE0F"));
  assert.throws(() => p.requireRadioAllowed(), /WebRTC/);
  assert.throws(() => p.requireClipboardAllowed(), /utklippstavlen/);
});
test("high-risk checks are enforced at transport and PTT entry points", () => {
  assert.match(read("github-sync.js"), /requirePrivateRepo\(repoData\)/);
  assert.match(read("github-sync.js"), /requireStrongChannelKey\(password\)/);
  assert.match(read("nest-wizard-v091.js"), /requirePrivateRepo\(data\)/);
  assert.match(read("nest-ptt-v091.js"), /requireRadioAllowed\(\)/);
  assert.match(read("nest-wizard-v091.js"), /requireClipboardAllowed\(\)/);
  assert.match(read("security-v07.js"), /requireClipboardAllowed\(\)/);
  assert.match(read("nest-wizard-v091.js"), /state.pendingInvite = ""/);
});
test("Android reduces WebView, capture, external intents and debugging exposure", () => {
  const j = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.match(j, /WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(j, /setWebContentsDebuggingEnabled\(false\)/);
  assert.match(j, /setAllowContentAccess\(false\)/);
  assert.match(j, /setAcceptThirdPartyCookies\(webView, false\)/);
  assert.match(j, /"github\.com"\.equalsIgnoreCase\(host\)/);
  assert.match(j, /"chatgpt\.com"\.equalsIgnoreCase\(host\)/);
});
test("encrypted data survives failures; never overwrite unreadable ciphertext", () => {
  const j = read("android/app/src/main/java/no/blckswan/nestchannel/SecureStore.java");
  const js = read("storage-sandbox.js");
  assert.match(j, /originalen er bevart/);
  assert.match(j, /synchronized boolean contains/);
  assert.match(js, /refusing overwrite/);
});
test("risk profile is bundled and cache version incremented", () => {
  for (const p of ["index.html", "service-worker.js", "android/app/build.gradle"])
    assert.match(read(p), /high-threat\.js/, p);
  assert.match(read("service-worker.js"), /nest-channel-v20/);
});

test("JavaScript may not query private native-only OAuth PKCE verifier or state", () => {
  const java = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.match(java, /private static boolean webSecretAllowed\(String key\)/);
  assert.match(java, /if \(!webSecretAllowed\(key\)\) throw new SecurityException/);
  assert.match(java, /workspace_v091_/);
  const block = java.slice(java.indexOf("private static boolean webSecretAllowed"), java.indexOf("private final class NativeBridge"));
  assert.doesNotMatch(block, /PKCE_VERIFIER_KEY|PKCE_STATE_KEY/);
});
test("external-intent bridge opens only explicit account/help pages", () => {
  const java = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.match(java, /"\/login\/device"\.equals\(path\)/);
  assert.match(java, /"\/settings\/personal-access-tokens\/new"\.equals\(path\)/);
  assert.match(java, /if \(!githubAllowed && !helpAllowed\) return/);
  assert.match(java, /uri\.getUserInfo\(\) != null/);
});

test("network egress is limited to trusted asset origin and GitHub API", () => {
 const j=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 assert.match(j, /"appassets\.androidplatform\.net"\.equalsIgnoreCase\(host\)/);
 assert.match(j, /"api\.github\.com"\.equalsIgnoreCase\(host\)/);
 assert.match(j, /return blockedResource\(403\)/);
 assert.match(j, /blockedResource\(404\)/);
});
test("private repo is rechecked before every GitHub snapshot upload", () => {
 const js=read("github-sync.js");
 const part=js.slice(js.indexOf("async function publishWorkspace"),js.indexOf("async function attemptPublish"));
 assert.match(part,/requirePrivateRepo\(repoData\)/);
 assert.match(part,/requireNative\(\)/);
 assert.match(read("index.html"), /id="relayUrl" type="text" value=""/);
});
test("native app cannot leave channel password in WebView sessionStorage", () => {
 const js=read("storage-sandbox.js");
 assert.match(js,/nativeStore\(\)\.saveSecret\("channel_password"/);
 assert.match(js,/if \(nativeStore\(\)\)/);
 assert.match(read("high-threat.js"),/function requireNative\(\)/);
});

test("native Android owns the threat-profile policy and microphone gate", () => {
 const java = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 const js = read("high-threat.js");
 assert.match(java, /THREAT_PROFILE_KEY/);
 assert.match(java, /getBoolean\(THREAT_PROFILE_KEY, true\)/);
 assert.match(java, /if \(isHighThreatStrict\(\)\) \{ request\.deny\(\); return; \}/);
 assert.match(java, /new AlertDialog\.Builder\(MainActivity\.this\)/);
 assert.match(java, /requestThreatProfileToggle\(\)/);
 assert.match(js, /window\.NativeHost\?\.isHighThreatMode\?\.\(\)/);
 assert.match(js, /window\.NativeHost\.requestThreatProfileToggle\(\)/);
 assert.doesNotMatch(js, /localStorage\.setItem\(KEY/);
});

test("local v4 sessions rotate, authenticate freshness, reject replay and bound resource use", () => {
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/PROTOCOL_VERSION = 7/);
 assert.match(java,/SESSION_ROTATE_MS = 15 \* 60_000L/);
 assert.match(java,/scheduleAtFixedRate\(this::rotateLocalSession/);
 assert.match(java,/sessionKeyPair = fresh/);
 assert.match(java,/peer\.clearReplay\(\)/);
 assert.match(java,/MAX_SIGNED_HELLO_SKEW_MS/);
 assert.match(java,/helloCanonical\(sender, identity, session, nonce, sentAt\)/);
 assert.match(java,/sentAt <= peer\.lastSignedHello/);
 assert.match(java,/epoch\.equals\(peer\.epoch\)/);
 assert.match(java,/peer\.rememberAuthenticated\(messageId\)/);
 assert.match(java,/Mac\.getInstance\("HmacSHA256"\)/);
 assert.match(java,/cipher\.updateAAD\(aadForSequence/);
 assert.match(java,/MAX_ACTIVE_ASSEMBLIES/);
 assert.match(java,/MAX_FRAGMENT_COUNT/);
 assert.match(java,/MAX_WORKSPACE_BYTES/);
 assert.match(read("SECURITY-READINESS.json"),/"release_blocked": true/);
});
test("GitHub sync surfaces Keystore failure and cleans failed connection",()=>{
 const js=read("github-sync.js");
 assert.match(js,/window\.NativeHost\.loadSecret\(key\) !== String\(value\)/);
 assert.match(js,/disconnectGithub\(\);\s*setConnectionState\("offline"/);
 assert.doesNotMatch(js,/function secretSave\(key, value\) \{\s*try/);
});

test("strict profile refuses all legacy whole-workspace sync transports until reviewed FS migration",()=>{
 const policy=require("../high-threat.js");
 assert.throws(()=>policy.requireForwardSecretTransport("github_workspace"),/forward secrecy/);
 assert.throws(()=>policy.requireForwardSecretTransport("local_workspace"),/forward secrecy/);
 assert.throws(()=>policy.requireForwardSecretTransport("legacy_wizard"),/forward secrecy/);
 const repo=read("github-sync.js"), wizard=read("nest-wizard-v091.js"), ui=read("ux-v06.js");
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 assert.match(repo,/requireForwardSecretTransport\?\.\("github_workspace"\)/);
 assert.match(wizard,/requireForwardSecretTransport\?\.\("legacy_wizard"\)/);
 assert.match(ui,/requireForwardSecretTransport\?\.\("local_workspace"\)/);
 assert.match(java,/if \(isHighThreatStrict\(\)\) throw new SecurityException\("Ingen forward secrecy/);
 assert.match(read("SECURITY-READINESS.json"),/"release_blocked": true/);
});
