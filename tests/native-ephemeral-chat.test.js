"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createCipheriv,createDecipheriv,randomBytes}=require("node:crypto");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");

test("strict Android mode permits secure single-chat transport but rejects old snapshots",()=>{
 const native=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 const bridge=native.slice(native.indexOf("private final class LocalBridge"),native.indexOf("@JavascriptInterface public void addPeer(",native.indexOf("private final class LocalBridge")));
 assert.match(bridge,/void start\(\)\s*\{\s*\/\/ Strict profile permits per-message local chat/);
 assert.match(bridge,/if \(isHighThreatStrict\(\)\) throw new SecurityException\("Ingen forward secrecy for gamle arbeidsflatesnapshots/);
 assert.match(bridge,/int sendChat\(String json\)/);
 assert.match(native,/onChat\(String json\)/);
});
test("native v7 message frame contains only one incoming chat and never a stored workspace",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/PROTOCOL_VERSION = 7/);
 assert.match(java,/int sendChat\(String json\)/);
 assert.match(java,/if \(recipients == 0\) return 0;/);
 assert.match(java,/activeScheduler\.execute\(\(\) -> sendChatNow\(json\)\)/);
 assert.match(java,/sendEncryptedToPeer\(json, peer, "secure_chat"\)/);
 assert.match(java,/chunk\.put\("type", messageType\)/);
 assert.match(java,/listener\.onChat\(workspace\)/);
 assert.match(java,/listener\.onWorkspace\(workspace\)/);
 assert.match(java,/Assembly\(total, iv, sequence, type\)/);
 assert.match(java,/assembly\.type\.equals\(type\)/);
 assert.match(java,/":kind:" \+ messageType/);
 assert.doesNotMatch(java.slice(java.indexOf("private void sendChatNow("),java.indexOf("private synchronized void sendWorkspaceToPeer")),/lastWorkspace/);
});
test("outgoing native message is not marked sent without an active paired receiver",()=>{
 const app=read("app.js");
 assert.match(app,/const receivers = Number\(window\.NativeLocal\?\.sendChat\?\.\(JSON\.stringify\(message\)\)/);
 assert.match(app,/if \(!receivers && !window\.NEST_GITHUB_CONNECTED\)/);
 assert.match(app,/Meldingen er ikke sendt/);
 assert.match(app,/return; \/\/ Keep text in composer/);
 const view=read("ux-v06.js");
 assert.match(view,/onChat\(raw\)/);
 assert.match(view,/window\.NEST_ReceiveLocalChat\?\.\(raw\)/);
 assert.match(view,/if \(!autoLocalStarted \|\| window\.NESTSecurity\?\.isStrict\?\.\(\)\) return/);
 assert.match(app,/persist\(\{ sync: false \}\)/);
});
test("authenticated frame type binding prevents converting snapshot ciphertext into chat",()=>{
 const key=randomBytes(32),iv=randomBytes(12);
 const aad=(type)=>Buffer.from("NEST-LOCAL-V7-AEAD:two-phones:epoch-1:seq:1:kind:"+type);
 const enc=createCipheriv("aes-256-gcm",key,iv);
 enc.setAAD(aad("secure_workspace"));
 const ct=Buffer.concat([enc.update("historic workspace","utf8"),enc.final()]);
 const tag=enc.getAuthTag();
 const d=createDecipheriv("aes-256-gcm",key,iv);
 d.setAAD(aad("secure_chat"));
 d.setAuthTag(tag);
 assert.throws(()=>Buffer.concat([d.update(ct),d.final()]));
});
test("new transport changes no signing readiness flags and does not claim full FS",()=>{
 const readiness=JSON.parse(read("SECURITY-READINESS.json"));
 assert.equal(readiness.release_blocked,true);
 assert.ok(readiness.criteria.every(item=>item.status==="unverified"));
 const gh=read("github-sync.js");
 assert.match(gh,/requireForwardSecretTransport\?\.\("github_workspace"\)/);
 const app=read("app.js");
 assert.doesNotMatch(app.slice(app.indexOf("window.NEST_ReceiveLocalChat"),app.indexOf("function renderChat()")),/publishWorkspace/);
});
