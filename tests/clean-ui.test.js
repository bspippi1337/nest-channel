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
  assert.match(read("service-worker.js"), /nest-channel-v12/);
});
