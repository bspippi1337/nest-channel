const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("campaign design covers dashboard, taskboard, secure-channel, About and wizard", () => {
  const html = read("index.html");
  const css = read("art-direction.css");
  for (const name of ["nest-intro", "pane-intro", "about-feature-art", "about-trust", "trust-grid", "emptyTemplate", "aboutTitle", "connectButton", "taskForm", "chatForm"]) {
    assert.ok(html.includes(name), `Missing view: ${name}`);
  }
  for (const name of [".nest-intro", ".task-card", ".channel-pane", ".nest91-dialog", ".nest91-progress", ".about-hero", ".about-trust", ".nest-pair-dialog", ".nest91-radio", ".mobile-nav"]) {
    assert.ok(css.includes(name), `Missing styled component: ${name}`);
  }
});

test("all original UI interaction IDs, security controls and dialogs survive design refresh", () => {
  const html = read("index.html");
  for (const id of ["connectButton", "disconnectButton", "taskList", "taskForm", "taskTitle", "taskAssignee", "taskDependency", "filters", "searchInput", "chatInput", "chatList", "chatForm", "aboutDialog", "closeAboutButton", "aboutStartButton", "taskDialog", "emptyTemplate"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(read("high-threat.js").includes("requestThreatProfileToggle"));
  assert.ok(read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java").includes("isHighThreatStrict"));
});

test("vector assets are bundled locally; no remote fonts, visual trackers or unsafe external images", () => {
  const html = read("index.html"), gradle = read("android/app/build.gradle"), sw = read("service-worker.js");
  for (const asset of ["art-direction.css", "nest-orbit.svg", "nest-flow.svg", "nest-empty.svg", "icon.svg"]) {
    assert.ok(fs.existsSync(path.join(root, asset)), asset);
    assert.ok(html.includes(asset), `Not displayed: ${asset}`);
    assert.ok(gradle.includes(asset), `Not bundled by Gradle: ${asset}`);
    assert.ok(sw.includes(asset), `Not cached for offline: ${asset}`);
  }
  assert.match(sw, /nest-channel-v16/);
  assert.doesNotMatch(html, /https?:\/\/(fonts\.|images\.|cdn\.)/);
  for (const name of ["nest-orbit.svg","nest-flow.svg","nest-empty.svg","icon.svg"]) {
    const svg = read(name);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<script|onload=|xlink:href="https?:/i);
  }
});

test("mobile design respects safe-area, supported widths and reduced motion", () => {
  const css = read("art-direction.css");
  assert.match(css, /max-width: 560px/);
  assert.match(css, /max-width: 365px/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /overscroll-behavior: contain/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const js = read("nest-wizard-v091.js");
  assert.match(js, /aria-valuenow/);
  assert.match(js, /nest91-progress/);
});

test("About includes illustrated editorial story and up-to-date honest release labeling", () => {
  const js = read("about.js");
  const html = read("index.html");
  assert.match(js, /ILLUSTRERT HISTORIE/);
  assert.match(js, /nest-flow\.svg/);
  assert.match(js, /Versjon 0\.9\.3/);
  assert.match(html, /ikke dokumentert anonymitet, forward secrecy/);
  assert.match(html, /SIKKERHET/);
  assert.doesNotMatch(js, /Versjon 0\.[578]\./);
});
