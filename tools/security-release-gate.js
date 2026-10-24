#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const file = path.resolve(__dirname, "..", "SECURITY-READINESS.json");
function verify(data) {
  if (!data || data.schema !== 1 || !Array.isArray(data.criteria) || data.criteria.length < 8)
    throw new Error("Missing complete security acceptance register");
  const errors = [];
  const seen = new Set();
  for (const check of data.criteria) {
    if (typeof check.id !== "string" || !/^[a-z][a-z0-9_]+$/.test(check.id) || seen.has(check.id))
      errors.push("invalid/duplicate criterion");
    seen.add(check.id);
    if (check.status !== "verified") errors.push(check.id + ": not independently verified");
    if (typeof check.evidence_url !== "string" || !/^https:\/\/[^/\s]+\/\S+/.test(check.evidence_url))
      errors.push(check.id + ": evidence URL missing");
    if (typeof check.approved_by !== "string" || check.approved_by.trim().length < 3)
      errors.push(check.id + ": independent approver missing");
  }
  if (data.release_blocked !== false) errors.push("release_blocked must be explicitly cleared after external audit");
  return errors;
}
if (require.main === module) {
  try {
    const errors = verify(JSON.parse(fs.readFileSync(file, "utf8")));
    if (errors.length) {
      console.error("BLOCKED: Security release gate has " + errors.length + " unmet conditions:");
      for (const e of errors) console.error("  - " + e);
      process.exitCode = 1;
    } else console.log("Security evidence register complete. Independent proof must still be manually reviewed.");
  } catch (e) { console.error("BLOCKED: " + e.message); process.exitCode = 1; }
}
module.exports = { verify };
