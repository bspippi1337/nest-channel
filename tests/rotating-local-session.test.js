const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { generateKeyPairSync, diffieHellman, createHash, hkdfSync, randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root,p),"utf8");

// These are executable reference vectors for the Java v4 transcript and KDF,
// not a substitute for Android instrumentation, peer-to-peer tests, or an audit.
function session(aNode, a, bNode, b) {
  const [first,second] = aNode.localeCompare(bNode) <= 0
    ? [[aNode,a],[bNode,b]] : [[bNode,b],[aNode,a]];
  const pub = key => key.publicKey.export({type:"spki",format:"der"}).toString("base64");
  const transcript = "NEST-LOCAL-V5-TRANSCRIPT:" + first[0] + ":" + pub(first[1]) + ":" + second[0] + ":" + pub(second[1]);
  const secret = diffieHellman({privateKey:a.privateKey,publicKey:b.publicKey});
  const salt = createHash("sha256").update(transcript).digest();
  const key = Buffer.from(hkdfSync("sha256",secret,salt,Buffer.from("NEST-LOCAL-V5-TRAFFIC"),32));
  const epoch = createHash("sha256").update(transcript).digest("hex").slice(0,32).toUpperCase();
  secret.fill(0);
  return {key,epoch};
}
const pair = () => generateKeyPairSync("ec",{namedCurve:"prime256v1"});
function encryptForSession(key,epoch,plaintext,sequence=1) {
 const iv=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",key,iv);
 cipher.setAAD(Buffer.from("NEST-LOCAL-V5-AEAD:NEST-LOCAL-V5:phone-A:phone-B:"+epoch+":seq:"+sequence));
 const ct=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 return {iv,ct,tag:cipher.getAuthTag()};
}
function decryptForSession(key,epoch,packet,sequence=1) {
 const decipher=createDecipheriv("aes-256-gcm",key,packet.iv);
 decipher.setAAD(Buffer.from("NEST-LOCAL-V5-AEAD:NEST-LOCAL-V5:phone-A:phone-B:"+epoch+":seq:"+sequence));
 decipher.setAuthTag(packet.tag);
 return Buffer.concat([decipher.update(packet.ct),decipher.final()]);
}
test("v4 ECDH/HKDF transcript agrees between independently generated phone keys",()=>{
 const a=pair(), b=pair();
 const A=session("phone-A",a,"phone-B",b);
 const B=session("phone-B",b,"phone-A",a);
 assert.deepEqual(A.key,B.key);
 assert.equal(A.epoch,B.epoch);
 const packet=encryptForSession(A.key,A.epoch,Buffer.from("not a real NEST user message"));
 assert.equal(decryptForSession(B.key,B.epoch,packet).toString(),"not a real NEST user message");
});
test("rotating either ephemeral ECDH key invalidates old session traffic",()=>{
 const a=pair(),b=pair(),c=pair();
 const old=session("phone-A",a,"phone-B",b);
 const next=session("phone-A",c,"phone-B",b);
 assert.notDeepEqual(next.key,old.key);
 assert.notEqual(next.epoch,old.epoch);
 const ciphertext=encryptForSession(old.key,old.epoch,Buffer.from("old epoch"));
 assert.throws(()=>decryptForSession(next.key,next.epoch,ciphertext));
});
test("epoch associated-data binding rejects wrong session identification",()=>{
 const a=pair(),b=pair();
 const s=session("phone-A",a,"phone-B",b);
 const packet=encryptForSession(s.key,s.epoch,Buffer.from("message"));
 assert.throws(()=>decryptForSession(s.key,"0".repeat(32),packet));
});
test("actual GitHub parser rejects malicious, oversized and inconsistent multipart inputs",()=>{
 const source=read("github-sync.js");
 const begin=source.indexOf("  function parseEncryptedComment(body) {");
 const end=source.indexOf("\n  function commentChunk(",begin);
 assert.ok(begin>0 && end>begin,"actual parser must be testable");
 const context={COMMENT_MARKER:"<!-- NEST-E2EE-V1 -->",roomId:"room",MAX_CHUNK:44000,MAX_ENVELOPE_PARTS:128};
 vm.runInNewContext(source.slice(begin,end)+"\nthis.parseComment=parseEncryptedComment;",context);
 const parse=x=>context.parseComment(context.COMMENT_MARKER+"\n"+JSON.stringify(x));
 const base={v:2,room:"room",id:"abc1234",iv:Buffer.alloc(12).toString("base64"),data:"AAAA",part:1,total:1};
 assert.equal(parse(base).id,"abc1234");
 for(const invalid of [
  {...base,total:10000000},
  {...base,total:2,part:3},
  {...base,total:-1},
  {...base,id:"../../../../bad"},
  {...base,data:"A".repeat(44001)},
  {...base,iv:"not-a-real-iv"},
  {...base,room:"someone-else"}
 ])assert.equal(parse(invalid),null,"invalid payload must be rejected");
});
test("local transport is v4-only and release remains blocked",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/PROTOCOL_VERSION = 5/);
 assert.match(java,/trustedPrefs\.edit\(\)\.clear\(\)\.commit\(\)/);
 assert.match(java,/hello_floor\./);
 assert.match(java,/MAX_WORKSPACE_BYTES/);
 assert.match(java,/MAX_ACTIVE_ASSEMBLIES = 8/);
 const js=read("github-sync.js");
 assert.match(js,/MAX_PENDING_GROUPS = 8/);
 assert.match(js,/MAX_PENDING_GROUP_BYTES = 2_500_000/);
 assert.match(java,/peer\.rememberAuthenticated\(messageId\)/);
 assert.match(read("SECURITY-READINESS.json"),/"release_blocked": true/);
});

test("QR invitation expiry is not mislabeled as a key-rotation security guarantee",()=>{
 const wizard=read("nest-wizard-v091.js");
 assert.match(wizard,/Forny QR-tid · samme kanalnøkkel/);
 assert.match(wizard,/QR-utløp gjelder invitasjonskoden, ikke kanalnøkkelen/);
 assert.doesNotMatch(wizard,/Lag ny QR med ny utløpstid/);
});
