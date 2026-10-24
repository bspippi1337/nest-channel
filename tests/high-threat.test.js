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
  assert.doesNotThrow(() => p.requireStrongChannelKey("a".repeat(43)));
  assert.throws(() => p.requireRadioAllowed(), /WebRTC/);
  assert.throws(() => p.requireClipboardAllowed(), /utklippstavlen/);
});
test("high-risk checks are enforced at transport and PTT entry points", () => {
  assert.match(read("github-sync.js"), /requirePrivateRepo\(repoData\)/);
  assert.match(read("github-sync.js"), /requireStrongChannelKey\(password\)/);
  assert.match(read("nest-wizard-v091.js"), /requirePrivateRepo\(data\)/);
  assert.match(read("nest-ptt-v091.js"), /requireRadioAllowed\(\)/);
  assert.match(read("nest-wizard-v091.js"), /requireClipboardAllowed\(\)/);
});
test("Android reduces WebView, capture, external intents and debugging exposure", () => {
  const j = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.match(j, /WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(j, /setWebContentsDebuggingEnabled\(false\)/);
  assert.match(j, /setAllowContentAccess\(false\)/);
  assert.match(j, /setAcceptThirdPartyCookies\(webView, false\)/);
  assert.match(j, /!"github\.com"\.equalsIgnoreCase\(host\)/);
  assert.match(j, /!"chatgpt\.com"\.equalsIgnoreCase\(host\)/);
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
