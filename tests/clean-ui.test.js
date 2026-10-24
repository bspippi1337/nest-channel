const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("0.9.2 ships only the current account setup wizard", () => {
  const sandbox = read("storage-sandbox.js");
  const worker = read("service-worker.js");
  const gradle = read("android/app/build.gradle");
  const pkg = read("package.json");
  for (const source of [sandbox, worker, gradle, pkg]) {
    assert.doesNotMatch(source, /onboarding-v08/);
  }
  for (const obsolete of ["onboarding-v08.js", "onboarding-v08.css"]) {
    assert.ok(!fs.existsSync(path.join(root, obsolete)), obsolete + " is obsolete");
  }
  assert.match(read("index.html"), /nest-wizard-v091.js/);
  assert.match(read("nest-wizard-v091.js"), /NESTINV1/);
});

test("no shell, terminal, aliases or Linux jokes in shipped UI", () => {
  const files = [
    "index.html", "styles.css", "ux-v06.js", "about.js", "about.css",
    "nest-wizard-v091.js", "nest-wizard-v091.css", "nest-ptt-v091.js",
    "security-v07.js", "security-v07.css"
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /\b(shell|terminal|linux|sudo|aliases?)\b/i, file);
  }
});

test("Android stays a plain app without executable terminal or command bridge", () => {
  const activity = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.doesNotMatch(activity, /Runtime\.getRuntime\(\)\.exec|ProcessBuilder|\.addJavascriptInterface\([^)]*Shell/);
  assert.match(read("android/app/build.gradle"), /versionName '0\.9\.2'/);
  assert.match(read("service-worker.js"), /nest-channel-v14/);
});

test("wizard stays inside Android bars and all scrollable steps", () => {
  const css = read("nest-wizard-v091.css");
  const java = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.match(css, /height:calc\(100dvh - 24px\)/);
  assert.match(css, /min-height:0/);
  assert.match(css, /overflow-y:auto/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(java, /WindowInsetsCompat\.Type\.systemBars\(\)/);
  assert.match(java, /WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(java, /WindowInsetsCompat\.Type\.ime\(\)/);
  assert.match(java, /layout\.setMargins/);
});

test("private GitHub repository is default, can be converted, and invites collaborators", () => {
  const js = read("nest-wizard-v091.js");
  assert.match(js, /visibility: "private"/);
  assert.match(js, /async function privatizeRepo\(\)/);
  assert.match(js, /method: "PATCH", body: \{ private: true \}/);
  assert.match(js, /Gjør eksisterende repo privat og fortsett/);
  assert.match(js, /collaborators\/"/);
  assert.match(js, /permission: "push"/);
  assert.match(js, /Tidligere offentlig innhold kan være kopiert/);
});

test("private GitHub OAuth can access private Issues and Android hotfix is upgradeable", () => {
  const java = read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
  assert.match(java, /repo read:user/);
  assert.doesNotMatch(java, /public_repo read:user/);
  assert.match(read("android/app/build.gradle"), /versionCode 14/);
});
