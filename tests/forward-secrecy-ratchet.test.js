"use strict";
// Developer-level reference model for NEST local v6 send/receive chain.
// The Android implementation is independently compiled by Android CI.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createHmac,randomBytes,createCipheriv,createDecipheriv} = require("node:crypto");
const read = p => fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
function mac(k,s){return createHmac("sha256",k).update(s).digest();}
function init(shared,epoch,sender,receiver){
 return mac(shared,"NEST-LOCAL-V7-CHAIN:"+epoch+":"+sender+":"+receiver);
}
function step(ck){return {message:mac(ck,"NEST-LOCAL-V7-MESSAGE"),next:mac(ck,"NEST-LOCAL-V7-NEXT")};}
function pair(epoch="A1B2C3"){
 const root=randomBytes(32);
 return {alice:{send:init(root,epoch,"A","B"),recv:init(root,epoch,"B","A"),ss:0,rs:0},bob:{send:init(root,epoch,"B","A"),recv:init(root,epoch,"A","B"),ss:0,rs:0}};
}
function seal(device,message,epoch="A1B2C3"){
 const s=step(device.send);device.send.fill(0);device.send=s.next;device.ss++;
 const nonce=randomBytes(12), a=createCipheriv("aes-256-gcm",s.message,nonce);
 a.setAAD(Buffer.from("NEST-V6:"+epoch+":"+device.ss));
 const encrypted=Buffer.concat([a.update(Buffer.from(message)),a.final()]);
 s.message.fill(0);
 return {n:device.ss,iv:nonce,body:encrypted,tag:a.getAuthTag()};
}
function open(device,packet,epoch="A1B2C3"){
 if(packet.n<=device.rs || packet.n-device.rs>128)return null;
 let candidate=Buffer.from(device.recv),mk=null;
 for(let n=device.rs;n<packet.n;n++){const z=step(candidate);candidate.fill(0);candidate=z.next;if(mk)mk.fill(0);mk=z.message;}
 try {
  const d=createDecipheriv("aes-256-gcm",mk,packet.iv);
  d.setAAD(Buffer.from("NEST-V6:"+epoch+":"+packet.n));d.setAuthTag(packet.tag);
  const txt=Buffer.concat([d.update(packet.body),d.final()]).toString();
  device.recv.fill(0);device.recv=candidate;candidate=null;device.rs=packet.n;
  return txt;
 }catch{return null;}
 finally{if(candidate)candidate.fill(0);if(mk)mk.fill(0);}
}
test("v7 opposite directional chains agree, multiple messages authenticate",()=>{
 const {alice,bob}=pair();
 const packets=[seal(alice,"first"),seal(alice,"second"),seal(alice,"third")];
 assert.equal(open(bob,packets[0]),"first");
 assert.equal(open(bob,packets[1]),"second");
 assert.equal(open(bob,packets[2]),"third");
 const reply=seal(bob,"reply");
 assert.equal(open(alice,reply),"reply");
});
test("v7 old message key is not derivable from next chain secret",()=>{
 const {alice,bob}=pair();const first=seal(alice,"historic");
 assert.equal(open(bob,first),"historic");
 const stolenNextChain=Buffer.from(bob.recv);
 const wrongStep=step(stolenNextChain);
 const attempt=createDecipheriv("aes-256-gcm",wrongStep.message,first.iv);
 attempt.setAAD(Buffer.from("NEST-V6:A1B2C3:1")); attempt.setAuthTag(first.tag);
 assert.throws(()=>Buffer.concat([attempt.update(first.body),attempt.final()]));
});
test("v6 tampered ciphertext must NOT consume receive chain state",()=>{
 const {alice,bob}=pair();const packet=seal(alice,"original");
 const damaged={...packet,body:Buffer.from(packet.body)};damaged.body[0]^=1;
 assert.equal(open(bob,damaged),null);
 assert.equal(bob.rs,0);
 assert.equal(open(bob,packet),"original");
});
test("v6 bounded skip accepts fresh packet but forbids historical replay",()=>{
 const {alice,bob}=pair();const frames=Array.from({length:15},(_,i)=>seal(alice,"snapshot-"+(i+1)));
 assert.equal(open(bob,frames[9]),"snapshot-10");
 assert.equal(open(bob,frames[1]),null);
 assert.equal(open(bob,frames[14]),"snapshot-15");
 assert.equal(bob.rs,15);
});
test("v6 refuses huge sequence jump without ratchet computation",()=>{
 const {alice,bob}=pair();const p=seal(alice,"one");p.n=100000000;
 assert.equal(open(bob,p),null);assert.equal(bob.rs,0);
});
test("Java native local transport consumes message keys and erases past chains",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/PROTOCOL_VERSION = 7/);
 assert.doesNotMatch(java,/peer\.key/);
 assert.match(java,/Arrays\.fill\(root, \(byte\) 0\)/);
 assert.match(java,/NEST-LOCAL-V7-CHAIN:/);
 assert.match(java,/NEST-LOCAL-V7-MESSAGE/);
 assert.match(java,/NEST-LOCAL-V7-NEXT/);
 assert.match(java,/peer\.sendChain = step\.nextChain/);
 assert.match(java,/Arrays\.fill\(peer\.sendChain, \(byte\) 0\)/);
 assert.match(java,/peer\.receiveChain = candidate/);
 assert.match(java,/sequence - peer\.highestReceivedSequence > 128/);
 assert.match(java,/Arrays\.fill\(step\.messageKey, \(byte\) 0\)/);
 assert.match(java,/cipher\.updateAAD\(aadForSequence/);
 assert.match(read("SECURITY-READINESS.json"),/"release_blocked": true/);
});
