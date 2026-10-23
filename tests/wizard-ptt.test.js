const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("v0.9.1 supports both public and private repos", () => {
  const js = read("nest-wizard-v091.js");
  assert.match(js, /visibility: "private"/);
  assert.match(js, /private: state\.visibility === "private"/);
  assert.match(js, /https:\/\/github\.com\/signup/);
  assert.match(js, /NESTINV1/);
  assert.match(js, /encryptedRoundTrip/);
});

test("wizard never embeds GitHub or channel secrets in the AI help prompt", () => {
  const js = read("nest-wizard-v091.js");
  const help = js.slice(js.indexOf("function supportQuestion"), js.indexOf("async function aiHelp"));
  assert.doesNotMatch(help, /state\.(key|token|manualToken)|authToken\(\)/);
  assert.match(help, /Ikke be om konto-passord, token eller kanalnøkkel/);
});

test("PTT uses encrypted signaling on GitHub and streams live via WebRTC", () => {
  const js = read("nest-ptt-v091.js");
  assert.match(js, /RTCPeerConnection/);
  assert.match(js, /mediaDevices\.getUserMedia/);
  assert.match(js, /AES-GCM/);
  assert.match(js, /NEST-PTT-V1/);
  assert.match(js, /track\.enabled = false/);
  assert.match(js, /track\.enabled = true/);
  assert.match(js, /pointerdown/);
  assert.match(js, /pointercancel/);
  assert.match(js, /visibilitychange/);
  assert.doesNotMatch(js, /audio\/wav|audio\/webm|MediaRecorder/);
});

test("Android exposes only the microphone with same-origin verification", () => {
  const java = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(java, /PermissionRequest\.RESOURCE_AUDIO_CAPTURE/);
  assert.match(java, /appassets\.androidplatform\.net/);
  assert.match(java, /requestPermissions/);
  assert.match(java, /scanInviteQr/);
});

test("app includes PTT and wizard assets in both WebView and service worker", () => {
  const html = read("index.html"), gradle = read("android/app/build.gradle"), sw = read("service-worker.js");
  for (const name of ["nest-wizard-v091.js","nest-wizard-v091.css","nest-ptt-v091.js","nest-ptt-v091.css"]) {
    assert.ok(html.includes(name), name + " absent from index");
    assert.ok(gradle.includes(name), name + " absent from Android assets");
    assert.ok(sw.includes(name), name + " absent from service worker");
  }
});

test("existing snapshots still fail closed when their keys do not work", () => {
  const sync = read("github-sync.js");
  assert.match(sync, /hasWorkspaceEnvelopes/);
  assert.match(sync, /if \(!hasWorkspaceEnvelopes\) return false/);
  assert.match(sync, /ingen komplett dekrypterbar snapshot/);
});

test("local workspaces migrate from plaintext to Keystore-backed SecureStore", () => {
  const source = read("storage-sandbox.js");
  assert.match(source, /workspace_v091_/);
  assert.match(source, /window\.NativeHost/);
  assert.match(source, /nativeStore\(\)\.saveSecret\(secureKey, legacy\)/);
  assert.match(source, /originalRemove\.call\(this, mapped\)/);
});
