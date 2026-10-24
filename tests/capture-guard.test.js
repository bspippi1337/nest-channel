const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

test("capture mode is isolated to demo debug and never enables release screenshots", () => {
  const gradle = read("android/app/build.gradle");
  const activity = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const gate = JSON.parse(read("SECURITY-READINESS.json"));
  assert.match(gradle, /debug\\s*\\{[\\s\\S]*?applicationIdSuffix '\\.demo'/);
  assert.match(gradle, /debug\\s*\\{[\\s\\S]*?NEST_CAPTURE_DEMO', 'true'/);
  assert.match(gradle, /release\\s*\\{[\\s\\S]*?NEST_CAPTURE_DEMO', 'false'/);
  assert.match(activity, /BuildConfig\\.DEBUG && BuildConfig\\.NEST_CAPTURE_DEMO/);
  assert.match(activity, /clearFlags\\(WindowManager\\.LayoutParams\\.FLAG_SECURE\\)/);
  assert.match(activity, /else\\s*\\{\\s*getWindow\\(\\)\\.addFlags\\(WindowManager\\.LayoutParams\\.FLAG_SECURE\\)/);
  assert.match(manifest, /NEST DEMO/);
  assert.equal(gate.release_blocked, true);
});
