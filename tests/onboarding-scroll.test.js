const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("APK entrypoint loads onboarding style and code", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const asset of ["onboarding-v08.css", "onboarding-v08.js", "release-v09.js"]) {
    assert.ok(html.includes(asset), `missing: ${asset}`);
  }
});

test("wizard has bounded height and a touch-scrollable flex child", () => {
  const css = fs.readFileSync("onboarding-v08.css", "utf8");
  const fix = css.split("/* FIX v0.9.1:")[1];
  assert.ok(fix, "bounded layout fix absent");
  assert.match(fix, /\.nest-onboard-dialog\s*\{[^}]*height:\s*min\(/);
  assert.match(fix, /\.nest-onboard-shell\s*\{[^}]*height:\s*100%/);
  assert.match(fix, /\.nest-onboard-body\s*\{[^}]*min-height:\s*0/);
  assert.match(fix, /\.nest-onboard-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(fix, /\.nest-onboard-body\s*\{[^}]*touch-action:\s*pan-y/);
  assert.match(fix, /@media\s*\(max-width:\s*620px\)/);
});

test("wizard resets scroll on step change and keyboard resizes WebView", () => {
  assert.match(fs.readFileSync("onboarding-v08.js", "utf8"), /body\.scrollTop\s*=\s*0/);
  assert.match(fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8"), /windowSoftInputMode="adjustResize"/);
});
