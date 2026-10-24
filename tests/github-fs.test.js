"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {webcrypto}=require("node:crypto");
const {FSChannel,MARKER}=require("../github-fs.js");
const read=n=>fs.readFileSync(path.join(__dirname,"..",n),"utf8");
const room="a".repeat(64),secret="ABCDefgh0123456789_-".repeat(3);
const mem=()=>{let state="";return {load:()=>state,save:x=>{state=x;},peek:()=>state};};
async function paired(){
 const storeA=mem(),storeB=mem();
 const a=await new FSChannel({room,load:storeA.load,save:storeA.save,cryptoProvider:webcrypto}).open(secret);
 const b=await new FSChannel({room,load:storeB.load,save:storeB.save,cryptoProvider:webcrypto}).open(secret);
 const initialA=await a.bundle(),initialB=await b.bundle();
 assert.ok(await a.acceptBundle(initialB));
 assert.ok(await b.acceptBundle(initialA));
 return {a,b,storeA,storeB,initialA,initialB};
}
const event=()=>({id:"a6bfc2fe-b961-4294-90b8-31e77197a5b3",type:"chat",createdAt:"2026-10-24T12:00:00Z",message:{text:"hello"}});
test("two-phone simulated GitHub FS1 pairing pins identities and exchanges signed ECDH envelope",async()=>{
 const {a,b}=await paired();
 assert.ok(a.paired()&&b.paired());
 const packet=await a.seal(event());
 assert.equal(packet.kind,"message");
 assert.equal(JSON.stringify(packet).includes("hello"),false);
 assert.deepEqual(await b.openMessage(packet),event());
 assert.equal(await b.openMessage(packet),null);
});
test("consumed private ECDH prekey cannot decrypt recorded ciphertext after compromise",async()=>{
 const {a,b,storeB}=await paired();
 const pkt=await a.seal(event());
 const before=JSON.parse(storeB.peek());
 assert.ok(before.prekeys.some(p=>p.id===pkt.key));
 assert.deepEqual(await b.openMessage(pkt),event());
 const after=JSON.parse(storeB.peek());
 assert.equal(after.prekeys.some(p=>p.id===pkt.key),false);
 const reboot=await new FSChannel({room,load:storeB.load,save:storeB.save,cryptoProvider:webcrypto}).open("");
 assert.equal(await reboot.openMessage(pkt),null);
});
test("tampering, wrong recipient and wrong sender signature cannot consume a prekey",async()=>{
 const {a,b,storeB}=await paired();
 const pkt=await a.seal(event());
 const count=JSON.parse(storeB.peek()).prekeys.length;
 for(const change of [{data:pkt.data.replace(/^./,pkt.data[0]==="A"?"B":"A")},{to:"b".repeat(32)},{sig:"AAAA"},{nonce:"AAAA"}]){
  await assert.rejects(()=>b.openMessage({...pkt,...change}));
  assert.equal(JSON.parse(storeB.peek()).prekeys.length,count);
 }
 assert.deepEqual(await b.openMessage(pkt),event());
});
test("identity mismatch and unsigned fake prekey bundle are rejected",async()=>{
 const {a,b,initialA}=await paired();
 const next=await a.bundle();
 await assert.rejects(()=>b.acceptBundle({...next,identity:"evil"}));
 await assert.rejects(()=>b.acceptBundle({...next,from:"0".repeat(32)}));
 const forged={...initialA,from:"2".repeat(32)};
 await assert.rejects(()=>b.acceptBundle(forged));
});
test("sender never uses the same recipient prekey twice",async()=>{
 const {a,b}=await paired();
 const one=await a.seal(event()),two=await a.seal({...event(),id:"e59466e2-82d7-4513-8f21-e80e7f64524c"});
 assert.notEqual(one.key,two.key);
 assert.deepEqual(await b.openMessage(two),{...event(),id:"e59466e2-82d7-4513-8f21-e80e7f64524c"});
 assert.deepEqual(await b.openMessage(one),event());
});
test("offline exhaustion fails closed without old message-key reuse",async()=>{
 const {a}=await paired();
 for(let i=0;i<20;i++)await a.seal({...event(),id:"00000000-0000-4000-8000-"+String(i).padStart(12,"0")});
 await assert.rejects(()=>a.seal(event()),/no unused prekeys/i);
});
test("GitHub FS transport is isolated from legacy static-key snapshots",()=>{
 const g=read("github-sync.js"),native=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 assert.match(g,/async function connectGithubFs/);
 assert.match(g,/NEST-FS-ROOM/);
 assert.match(g,/await fsChannel\.seal\(event\)/);
 assert.match(g,/await fsChannel\.openMessage\(item\)/);
 assert.match(g,/if \(fsChannel\) \{ await receiveFsComment\(comment\); return; \}/);
 assert.match(g,/if \(window\.NESTSecurity\?\.isStrict\(\)\) \{\s*await connectGithubFs/);
 assert.match(native,/fs_state_\[a-f0-9\]\{64\}/);
 assert.match(read("SECURITY-READINESS.json"),/"release_blocked": true/);
 assert.match(read("service-worker.js"),/github-fs\.js/);
 assert.match(read("android/app/build.gradle"),/github-fs\.js/);
 assert.equal(MARKER,"<!-- NEST-FS1 -->");
});
