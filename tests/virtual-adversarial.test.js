/**
 * Deterministic adversarial simulation for NEST local v5.
 *
 * IMPORTANT: This tests a standalone cryptographic reference model and
 * executes the REAL GitHub fragment parser/reassembler inside a VM.
 * Node virtual phones are NOT a substitute for Java instrumentation or
 * real Android devices. Never mark high-risk security readiness verified
 * based on this test suite.
 */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {generateKeyPairSync,diffieHellman,createHash,hkdfSync,createCipheriv,createDecipheriv,randomBytes,sign,verify}=require("node:crypto");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const pub=kp=>kp.publicKey.export({format:"der",type:"spki"}).toString("base64");
const keypair=()=>generateKeyPairSync("ec",{namedCurve:"prime256v1"});
function sessionFor(local,remote){
 const nodes=[[local.id,pub(local.session)],[remote.id,pub(remote.session)]].sort((a,b)=>a[0].localeCompare(b[0]));
 const transcript="NEST-LOCAL-V5-TRANSCRIPT:"+nodes.map(x=>x.join(":")).join(":");
 const raw=diffieHellman({privateKey:local.session.privateKey,publicKey:remote.session.publicKey});
 const salt=createHash("sha256").update(transcript).digest();
 const key=Buffer.from(hkdfSync("sha256",raw,salt,Buffer.from("NEST-LOCAL-V5-TRAFFIC"),32));
 raw.fill(0);
 return {key,epoch:createHash("sha256").update(transcript).digest("hex").toUpperCase().slice(0,32)};
}
function phone(id){
 return {id,identity:keypair(),session:keypair(),highest:0,send:0,address:"192.0.2."+ (id==="phone-A"?"1":"2"),acceptedAt:0};
}
function signedHello(device,milliseconds,nonce="random-unique-nonce"){
 const canonical=["NEST-V5","hello",device.id,pub(device.identity),pub(device.session),nonce,milliseconds].join("|");
 return {...{id:device.id,identity:pub(device.identity),session:pub(device.session),nonce,milliseconds},
  signature:sign("sha256",Buffer.from(canonical),device.identity.privateKey)};
}
function acceptHello(local,remote,offer,source,now){
 const canonical=["NEST-V5","hello",offer.id,offer.identity,offer.session,offer.nonce,offer.milliseconds].join("|");
 if(offer.id!==remote.id || offer.identity!==pub(remote.identity))return false;
 if(!verify("sha256",Buffer.from(canonical),remote.identity.publicKey,offer.signature))return false;
 if(offer.milliseconds<=local.acceptedAt || Math.abs(offer.milliseconds-now)>90_000)return false;
 local.acceptedAt=offer.milliseconds;
 if(local.acceptedRemoteSession!==offer.session){
  // Simulate the production v5 receiver's authenticated epoch-change reset.
  local.acceptedRemoteSession=offer.session;
  local.highest=0;
 }
 local.address=source;
 return true;
}
function seal(sender,receiver,json,sequence){
 const session=sessionFor(sender,receiver),iv=randomBytes(12);
 const [a,b]=[sender.id,receiver.id].sort();
 const aad=Buffer.from("NEST-LOCAL-V5-AEAD:NEST-LOCAL-V5:"+a+":"+b+":"+session.epoch+":seq:"+sequence);
 const c=createCipheriv("aes-256-gcm",session.key,iv);
 c.setAAD(aad);
 const data=Buffer.concat([c.update(JSON.stringify(json),"utf8"),c.final()]);
 return {sequence,epoch:session.epoch,iv,data,tag:c.getAuthTag(),aad};
}
function receive(receiver,sender,frame,source){
 const session=sessionFor(receiver,sender);
 if(frame.epoch!==session.epoch || frame.sequence<=receiver.highest || frame.sequence<1)return false;
 const d=createDecipheriv("aes-256-gcm",session.key,frame.iv);
 // The raw untrusted sequence is bound to GCM AAD. It cannot be rewritten.
 const [a,b]=[sender.id,receiver.id].sort();
 d.setAAD(Buffer.from("NEST-LOCAL-V5-AEAD:NEST-LOCAL-V5:"+a+":"+b+":"+session.epoch+":seq:"+frame.sequence));
 d.setAuthTag(frame.tag);
 try{
  const value=JSON.parse(Buffer.concat([d.update(frame.data),d.final()]).toString("utf8"));
  receiver.highest=frame.sequence;
  // The SOURCE ADDRESS is intentionally NOT changed by ciphertext.
  receiver.lastMessage=value;
  return true;
 }catch{return false;}
}
function rotate(device){device.session=keypair();device.highest=0;device.send=0;}
function rng(seed=0x5eed1234){
 let n=seed>>>0;return ()=>{n^=(n<<13);n^=(n>>>17);n^=(n<<5);return (n>>>0)/0x100000000;};
}
function actualGithubFragmentEngine(){
 const src=read("github-sync.js");
 const start=src.indexOf("  function rememberComment(id) {");
 const end=src.indexOf("\n  async function fetchLatestSnapshot() {",start);
 assert.ok(start!==-1&&end>start);
 const merged=[];
 const ctx={
  COMMENT_MARKER:"<!-- NEST-E2EE-V1 -->",roomId:"R",MAX_CHUNK:44000,
  MAX_ENVELOPE_PARTS:128,MAX_PENDING_GROUPS:8,MAX_PENDING_GROUP_BYTES:2_500_000,
  MAX_SEEN_COMMENTS:8192,
  seenCommentIds:new Set(),chunkGroups:new Map(),
  decryptEnvelope:async e=>({kind:"workspace",workspace:{joined:e.data,id:e.id}}),
  mergeWorkspace:w=>merged.push(w),setConnectionState:()=>{}
 };
 vm.runInNewContext(src.slice(start,end)+"\nthis.receiveComment=receiveComment;this.parseEncryptedComment=parseEncryptedComment",ctx);
 let nextId=1;
 const make=(group,part,total,data="A",overrides={})=>({
  id:nextId++,body:ctx.COMMENT_MARKER+"\n"+JSON.stringify({
   v:2,kind:"snapshot",room:"R",id:group,iv:Buffer.alloc(12).toString("base64"),
   part,total,data,...overrides
  })
 });
 return {ctx,merged,make};
}

test("what-if #1: spoofed UDP source cannot redirect an established phone",()=>{
 const A=phone("phone-A"),B=phone("phone-B");
 const h=signedHello(B,1_000_001);
 assert.equal(acceptHello(A,B,h,"192.0.2.2",1_000_005),true);
 assert.equal(acceptHello(A,B,{...h,signature:Buffer.alloc(71)},"192.0.2.66",1_000_006),false);
 const frame=seal(B,A,{chat:"test"},1);
 assert.equal(receive(A,B,frame,"192.0.2.66"),true);
 assert.equal(A.address,"192.0.2.2");
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 const receiveSource=java.slice(java.indexOf("private synchronized void receiveMessage("),java.indexOf("private synchronized void receiveHello("));
 assert.doesNotMatch(receiveSource,/peer\.address\s*=\s*source/);
 assert.match(java,/if \(!verify\(identityKey, helloCanonical/);
});
test("what-if #2: replay after 1100 later packets is rejected by sequence watermark",()=>{
 const A=phone("phone-A"),B=phone("phone-B");
 const first=seal(B,A,{value:1},1);
 assert.equal(receive(A,B,first,"x"),true);
 for(let s=2;s<=1101;s++)assert.equal(receive(A,B,seal(B,A,{value:s},s),"x"),true);
 assert.equal(A.highest,1101);
 assert.equal(receive(A,B,first,"x"),false);
 assert.equal(A.lastMessage.value,1101);
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/sequence <= peer\.highestReceivedSequence/);
 assert.match(java,/peer\.highestReceivedSequence = sequence/);
});
test("what-if #3: tampered sequence cannot be authenticated even when increasing",()=>{
 const A=phone("phone-A"),B=phone("phone-B");
 const f=seal(B,A,{content:"original"},3);
 f.sequence=900_000;
 assert.equal(receive(A,B,f,"spoof"),false);
 assert.equal(A.highest,0);
 assert.equal(A.lastMessage,undefined);
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/cipher\.updateAAD\(aadForSequence\(sender, epoch, sequence\)\)/);
 assert.match(java,/cipher\.updateAAD\(aadForSequence\(peer\.nodeId, epoch, sequence\)\)/);
});
test("what-if #4: packet reordering and packet loss accept only latest authenticated workspace",()=>{
 const A=phone("phone-A"),B=phone("phone-B");
 const frames=[1,2,3,4,5].map(n=>seal(B,A,{value:n},n));
 assert.equal(receive(A,B,frames[2],"x"),true);
 assert.equal(receive(A,B,frames[0],"x"),false);
 assert.equal(receive(A,B,frames[1],"x"),false);
 assert.equal(receive(A,B,frames[4],"x"),true);
 assert.equal(receive(A,B,frames[3],"x"),false);
 assert.equal(A.lastMessage.value,5);
});
test("what-if #5: an attacker recording pre-rotation traffic cannot decrypt it with new session keys",()=>{
 const A=phone("phone-A"),B=phone("phone-B");
 const saved=seal(B,A,{old:"story"},1);
 rotate(B);
 assert.equal(receive(A,B,saved,"x"),false);
 const next=seal(B,A,{new:"story"},1);
 assert.equal(receive(A,B,next,"x"),true);
 assert.notEqual(next.epoch,saved.epoch);
 // WARNING: saved plaintext in NEST's workspace is a separate, unsolved problem.
});
test("what-if #6: signed HELLO replay, bad signature and clock drift are denied",()=>{
 const A=phone("phone-A"),B=phone("phone-B");
 const hello=signedHello(B,500000);
 assert.equal(acceptHello(A,B,hello,"192.0.2.2",500010),true);
 assert.equal(acceptHello(A,B,hello,"192.0.2.55",500050),false);
 assert.equal(acceptHello(A,B,signedHello(B,501000),"x",700001),false);
 assert.equal(acceptHello(A,B,{...signedHello(B,501000),id:"phone-C"},"x",501002),false);
 assert.equal(A.address,"192.0.2.2");
});
test("what-if #7: a burst of incomplete GitHub snapshots remains bounded",async()=>{
 const {ctx,make}=actualGithubFragmentEngine();
 for(let i=0;i<250;i++)await ctx.receiveComment(make("group"+i,1,2));
 assert.ok(ctx.chunkGroups.size<=8);
 assert.ok(ctx.chunkGroups.has("group249"));
 assert.equal(ctx.seenCommentIds.size,250);
});
test("what-if #8: a valid multipart Github snapshot still assembles out of order",async()=>{
 const {ctx,make,merged}=actualGithubFragmentEngine();
 const a=make("legit",1,3,"QUJD");
 const b=make("legit",2,3,"REVG");
 const c=make("legit",3,3,"R0hJ");
 await ctx.receiveComment(c);
 await ctx.receiveComment(a);
 assert.equal(merged.length,0);
 await ctx.receiveComment(b);
 assert.equal(merged.length,1);
 assert.equal(merged[0].joined,"QUJDREVGR0hJ");
 await ctx.receiveComment(b);
 assert.equal(merged.length,1);
});
test("what-if #9: malformed or excessive GitHub fragments cannot allocate pending state",async()=>{
 const {ctx,make}=actualGithubFragmentEngine();
 for(let i=0;i<200;i++){
  const random=rng(i+1);
  const oversized="A".repeat(45000+Math.floor(random()*1000));
  const item=make("evil"+i,1,2,oversized);
  await ctx.receiveComment(item);
 }
 assert.equal(ctx.chunkGroups.size,0);
 const invalid=make("badid",1,0,"AAAA");await ctx.receiveComment(invalid);
 assert.equal(ctx.chunkGroups.size,0);
});
test("what-if #10: missing durable revocation must stop local networking",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 const a=java.indexOf("synchronized void clearTrustedPeers()");
 const b=java.indexOf("String createPairingPayload()",a);
 const section=java.slice(a,b);
 assert.match(section,/if \(!trustedPrefs\.edit\(\)\.clear\(\)\.commit\(\)\)/);
 assert.match(section,/stop\(\)/);
 assert.match(section,/return;/);
 assert.match(section,/manualTargets\.clear\(\)/);
 assert.ok(section.indexOf("return;")<section.indexOf("listener.onPairingStatus(\"cleared\""));
});
test("what-if #11: release gate is unchanged despite a successful virtual lab",()=>{
 const readiness=JSON.parse(read("SECURITY-READINESS.json"));
 assert.equal(readiness.release_blocked,true);
 assert.ok(readiness.criteria.every(x=>x.status!=="verified"));
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/PROTOCOL_VERSION = 5/);
 assert.match(java,/private synchronized void sendWorkspaceToPeer/);
 assert.match(java,/private synchronized void receiveMessage/);
});

test("what-if #12: encrypted GitHub snapshots can still contain old plaintext after local rekey",()=>{
 const app=read("app.js"),sync=read("github-sync.js");
 assert.match(app,/workspace\.chat\s*=\s*NESTCore\.mergeById/);
 assert.match(sync,/encryptPayload\(\{ kind: "workspace", workspace \}\)/);
 const A=phone("phone-A"),B=phone("phone-B");
 const workspace={chat:[{id:"old",text:"retained before rotation"}]};
 const before=seal(A,B,workspace,1);
 assert.equal(receive(B,A,before,"host"),true);
 rotate(A);
 // Simulated authenticated HELLO must complete before a new epoch is used.
 assert.equal(acceptHello(B,A,signedHello(A,500_000),"host",500_001),true);
 const after=seal(A,B,workspace,1);
 assert.equal(receive(B,A,after,"host"),true);
 assert.equal(B.lastMessage.chat[0].text,"retained before rotation");
 // This is an expected and explicitly documented *negative* security result.
 assert.match(read("SECURITY-FORWARD-SECRECY-ROADMAP.md"),/does not.*forward secrecy|no forward secrecy|no.*forward secrecy/i);
});
test("what-if #13: zero and omitted v2 fragment counts never acquire memory",async()=>{
 const {ctx,make}=actualGithubFragmentEngine();
 for(const variant of [
  {total:0},{part:0},{total:null},{part:null},{total:undefined},
  {total:1.5},{part:-1},{total:NaN},{total:"2"},{part:"1"}
 ]){
  const c=make("bad-counter",1,1,"AAAA",variant);
  await ctx.receiveComment(c);
 }
 assert.equal(ctx.chunkGroups.size,0);
});
