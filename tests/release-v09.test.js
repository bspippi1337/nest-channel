const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("v0.9 targets Android API 36 with stable package identity", () => {
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /applicationId 'no\.blckswan\.nestchannel'/);
  assert.match(gradle, /compileSdk 36/);
  assert.match(gradle, /targetSdk 36/);
  assert.match(gradle, /versionCode 11/);
  assert.match(gradle, /versionName '0\.9\.0'/);
});

test("signed release is gated by protected environment secrets", () => {
  const workflow = read(".github/workflows/release-v09.yml");
  assert.match(workflow, /environment: release/);
  assert.match(workflow, /NEST_RELEASE_KEYSTORE_B64/);
  assert.match(workflow, /NEST_RELEASE_CERT_SHA256/);
  assert.match(workflow, /Signing certificate mismatch/);
  assert.match(workflow, /assembleRelease :app:bundleRelease/);
});

test("private signing files are denied from git", () => {
  const ignore = read(".gitignore");
  for (const pattern of ["*.jks", "*.keystore", "*.p12", "*.pfx", "*.key"]) {
    assert.match(ignore, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("release milestones stay locked", () => {
  const plan = read("RELEASE_PLAN.md");
  assert.match(plan, /v0\.9\.x · Signed limited beta/);
  assert.match(plan, /maximum 20 registered devices/);
  assert.match(plan, /v1\.0\.0 · Google Play/);
  assert.match(plan, /preserve package name and app-signing identity from v0\.9/);
});
