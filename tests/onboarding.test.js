const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "onboarding-v08.js"), "utf8");

test("zero-setup uses official GitHub human signup and token pages", () => {
  assert.match(source, /https:\/\/github\.com\/signup/);
  assert.match(source, /https:\/\/github\.com\/settings\/personal-access-tokens\/new/);
  assert.match(source, /administration=write/);
  assert.match(source, /issues=write/);
});

test("zero-setup forces the generated sync repository private", () => {
  assert.match(source, /private:\s*true/);
  assert.match(source, /has_issues:\s*true/);
});

test("email is not persisted by onboarding", () => {
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*email/i);
  assert.doesNotMatch(source, /secretSave\([^\n]*email/i);
});

test("wizard does not contain disposable-mail or captcha bypass hooks", () => {
  assert.doesNotMatch(source, /10minute|tempmail|guerrillamail|captcha[_-]?bypass/i);
});
