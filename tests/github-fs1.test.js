"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
function select(src,start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0 && b>a,"Cannot extract actual implementation "+start);
 return src.slice(a,b);
}
test("strict GitHub connects to one-time prekey mailbox, not legacy snapshot writer",()=>{
 const js=read("github-sync.js");
 const connect=select(js,"  async function connectGithub() {","  function disconnectGithub() {");
 assert.match(connect,/fsMode=Boolean\(window\.NESTSecurity\?\.isStrict\?\.\(\)\)/);
 assert.match(connect,/if\(fsMode\)[\s\S]*?fsPublishBundle\(\)/);
 assert.match(connect,/await fsBootstrap\(\)/);
 assert.match(connect,/if\(fsMode\)[\s\S]*?roomKey=null/);
 assert.match(js,/if\(fsMode\)\{[\s\S]*?await fsPublishEvents\(\)/);
 assert.match(js,/if\(fsMode\)\{[\s\S]*?await fsPoll\(\)/);
 assert.match(read("SECURITY-READINESS.json"),/"release_blocked": true/);
});
test("Android bridge never exports a secret private prekey to JavaScript",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/GithubOneTimeFS.java");
 const bridge=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 for(const method of ["fingerprint","publicBundle","inspectBundle","pinnedFingerprint","pinVerified","encrypt","decrypt"])
  assert.match(bridge,new RegExp("public (?:String|void) "+method+"\\("));
 assert.doesNotMatch(bridge,/getOneTimePrivateKey|exportPrivateKey/);
 assert.match(java,/AndroidKeyStore/);
 assert.match(java,/store\.put\(p\+"\.secret\."\+id/);
 assert.match(java,/store\.remove\(entry\)/);
 assert.match(java,/if\(!verified\(publicKey\(sender\)/);
 assert.match(java,/if\(!fp\.equals\(pinnedFingerprint\(room\)\)\)/);
 assert.match(java,/if\(manuallyCheckedSuffix==null/);
 assert.match(java,/manuallyCheckedSuffix\.trim\(\)\.length\(\)!=12/);
 assert.match(java,/if\(encoded\.isEmpty\(\)\)return ""/);
 assert.match(java,/Arrays\.fill\(raw,\(byte\)0\)/);
});
test("real FS1 comment parser only accepts bounded frames for the exact channel",()=>{
 const src=read("github-sync.js");
 const p=select(src,"  function fsFrame(comment){","  async function fsReceive(comment){");
 const cx={roomId:"a".repeat(64),FS_MARKER:"<!-- NEST-GH-FS1 -->",JSON};
 vm.createContext(cx);vm.runInContext(p+"\nthis.decode=fsFrame",cx);
 const good={v:1,room:cx.roomId,kind:"sealed",id:"id"};
 const mk=x=>({id:5,body:cx.FS_MARKER+"\n"+JSON.stringify(x)});
 assert.equal(cx.decode(mk(good)).id,"id");
 assert.equal(cx.decode(mk({...good,room:"b".repeat(64)})),null);
 assert.equal(cx.decode(mk({...good,kind:"snapshot"})),null);
 assert.equal(cx.decode(mk({...good,v:0})),null);
 assert.equal(cx.decode({id:6,body:"<!-- NEST-E2EE-V1 -->\n"+JSON.stringify(good)}),null);
 assert.equal(cx.decode({id:7,body:cx.FS_MARKER+"\n"+"A".repeat(29000)}),null);
});
test("GitHub FS1 publisher stores ciphertext first and retries the same envelope",async()=>{
 const src=read("github-sync.js");
 const impl=select(src,"  async function fsPublishEvents(){","  function rememberComment(id) {");
 const event={id:"12345678-1234-1234-1234-123456789abc",type:"chat",message:{text:"Never plaintext on GitHub"}};
 let encrypted=0,posts=0,persisted=0;
 const ctx={
  roomId:"a".repeat(64),
  workspace:{outbox:[event]},
  fsPeerBundle:"peer-bundle",
  window:{},
  fsNative:()=>({
   pinnedFingerprint:()=>"verified",
   encrypt:()=>{encrypted++;return JSON.stringify({v:1,kind:"sealed",room:ctx.roomId,id:event.id,data:"ciphertext"});}
  }),
  fsPost:async()=>{posts++;if(posts===1)throw new Error("network dropped");return 1001;},
  fsStatus:()=>{},
  setConnectionState:()=>{},
  persist:()=>{persisted++;}
 };
 vm.createContext(ctx);vm.runInContext(impl+"\nthis.publish=fsPublishEvents;",ctx);
 await assert.rejects(ctx.publish(),/network dropped/);
 assert.equal(encrypted,1);
 assert.equal(ctx.workspace.outbox.length,1);
 assert.ok(ctx.workspace.outbox[0].fsEnvelope.includes("ciphertext"));
 await ctx.publish();
 assert.equal(encrypted,1,"must not consume a second prekey when POST timed out");
 assert.equal(ctx.workspace.outbox.length,0);
 assert.equal(posts,2);assert.ok(persisted>=2);
});
test("one-time ECDH protocol binds sender, receiver, room, prekey and message ID",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/GithubOneTimeFS.java");
 const required=[
  "NEST-GH-FS1|","KeyAgreement.getInstance(\"ECDH\")",
  "Cipher.getInstance(\"AES/GCM/NoPadding\")","c.updateAAD(utf8(ctx))",
  "SHA256withECDSA","verified(id,bundleText",
  "store.remove(entry);","store.put(usedKey,next.toString())",
  "store.put(p+\".list\",present.toString())"
 ];
 for(const term of required)assert.ok(java.includes(term),term);
 assert.match(java,/if\(!fp\.equals\(pinnedFingerprint\(room\)\)\)/);
 assert.match(java,/store\.remove\(entry\);[\s\S]*byte\[\] raw=shared\(priv/);
 assert.doesNotMatch(java,/createGroup|DoubleRatchet|claim.*certified/i);
});
