const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {verify}=require("../tools/security-release-gate.js");
const root=path.resolve(__dirname,"..");

test("unverified security criteria block signing (fail-closed)", () => {
  const doc=JSON.parse(fs.readFileSync(path.join(root,"SECURITY-READINESS.json"),"utf8"));
  const errors=verify(doc);
  assert.ok(errors.length>0);
  assert.match(errors.join(" " ), /independent_crypto_protocol_review/);
  assert.match(errors.join(" " ), /signing_play_continuity/);
});
test("release pipeline checks security gate before unlocking keystore secrets", () => {
  const flow=fs.readFileSync(path.join(root,".github/workflows/release-v09.yml"),"utf8");
  const gate=flow.indexOf("npm run security:gate");
  const secret=flow.indexOf("- name: Require signing secrets");
  assert.ok(gate>=0 && gate<secret);
  assert.match(flow,/gh release download v0\.9\.0/);
});
test("gate rejects missing/forged evidence metadata", () => {
  const doc=JSON.parse(fs.readFileSync(path.join(root,"SECURITY-READINESS.json"),"utf8"));
  const sample=structuredClone(doc);
  sample.release_blocked=false;
  for(const criterion of sample.criteria){
    criterion.status="verified";
    criterion.evidence_url="https://example.com/evidence/"+criterion.id;
    criterion.approved_by="External independent auditor";
  }
  assert.equal(verify(sample).length,0);
  sample.criteria[0].evidence_url="not-a-url";
  assert.ok(verify(sample).some(x=>x.includes("evidence URL")));
  sample.criteria[0].evidence_url="https://example.com/report";
  sample.criteria[0].approved_by="";
  assert.ok(verify(sample).some(x=>x.includes("approver")));
});
