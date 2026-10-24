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
  assert.match(read("service-worker.js"), /nest-channel-v14/);
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
