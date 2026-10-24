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
 assert.match(bridge,/setLegacyWorkspaceAllowed\(!isHighThreatStrict\(\)\)/);
 assert.match(bridge,/if \(isHighThreatStrict\(\)\) throw new SecurityException\("Ingen forward secrecy for gamle arbeidsflatesnapshots/);
 assert.match(bridge,/int sendChat\(String json\)/);
 assert.match(native,/onChat\(String json\)/);
});
test("native v7 message frame contains only one incoming chat and never a stored workspace",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/PROTOCOL_VERSION = 8/);
 assert.match(java,/int sendChat\(String json\)/);
 assert.match(java,/if \(recipients == 0\) return 0;/);
 assert.match(java,/activeScheduler\.execute\(\(\) -> sendChatNow\(json\)\)/);
 assert.match(java,/sendEncryptedToPeer\(json, peer, "secure_chat"\)/);
 assert.match(java,/chunk\.put\("type", messageType\)/);
 assert.match(java,/listener\.onChat\(chat\.toString\(\)\)/);
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
 const aad=(type)=>Buffer.from("NEST-LOCAL-V8-AEAD:two-phones:epoch-1:seq:1:kind:"+type);
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

test("native strict mode rejects old workspace snapshots before decrypting or advancing ratchet",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/void setLegacyWorkspaceAllowed\(boolean allowed\)/);
 assert.match(java,/if \(!legacyWorkspaceAllowed\) throw new SecurityException/);
 const start=java.indexOf('if ("secure_workspace".equals(type) && !legacyWorkspaceAllowed) return;');
 const advance=java.indexOf("byte[] candidate = peer.receiveChain.clone();",start);
 assert.ok(start>=0 && advance>start);
});
test("authenticated peer identity replaces untrusted sender clientId on local chat receive",()=>{
 const native=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(native,/chat\.put\("clientId", sender\)/);
 assert.match(native,/listener\.onChat\(chat\.toString\(\)\)/);
 assert.match(native,/display \+ " · " \+ sender\.substring/);
});

test("strict NativeBridge withholds old GitHub token and channel root from WebView",()=>{
 const src=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 const start=src.indexOf("public String loadSecret(String key)");
 const end=src.indexOf("@JavascriptInterface",start);
 const readBridge=src.slice(start,end);
 assert.match(readBridge,/isHighThreatStrict\(\)/);
 assert.match(readBridge,/"github_token"\.equals\(key\) \|\| "channel_password"\.equals\(key\)/);
 assert.match(readBridge,/return "";/);
});

test("strict messages are ephemeral in app workspace persistence, never serialized as chat history",()=>{
 const app=read("app.js");
 assert.match(app,/function strictEphemeralChat\(\)/);
 assert.match(app,/return strictEphemeralChat\(\) \? \{ \.\.\.workspace, chat: \[\] \} : workspace/);
 assert.match(app,/chat: strictEphemeralChat\(\) \? \[\] :/);
 const saves=[...app.matchAll(/localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(persistedWorkspace\(\)\)\)/g)];
 assert.ok(saves.length>=2);
 assert.doesNotMatch(app,/localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(workspace\)\)/);
 assert.match(app,/if \(!strictEphemeralChat\(\)\)\s*workspace\.chat = NESTCore\.mergeById/);
});
test("high-risk native chat requires recent authenticated peer and a usable route",()=>{
 const java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(java,/SystemClock\.elapsedRealtime\(\) - peer\.lastSeen <= PEER_TIMEOUT_MS/);
 assert.match(java,/peer\.address != null && peer\.lastSeen > 0L/);
 assert.match(java,/SystemClock\.elapsedRealtime\(\) - peer\.lastSeen > PEER_TIMEOUT_MS/);
 const ui=read("ux-v06.js");
 assert.match(ui,/!window\.NESTSecurity\?\.isStrict\?\.\(\)/);
 const app=read("app.js");
 assert.match(app,/if \(strictEphemeralChat\(\) && !window\.NEST_LOCAL_CONNECTED\)/);
});

test("v8 encrypted receipts are bound to wire type and acknowledge peer-side receipt only",()=>{
 const j=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 const act=read("android/app/src/main/java/no/blckswan/nestchannel/MainActivity.java");
 const app=read("app.js"), ui=read("ux-v06.js");
 assert.match(j,/sendEncryptedToPeer\(receipt\.toString\(\), peer, "secure_receipt"\)/);
 assert.match(j,/listener\.onChatReceipt\(ackId, sender\)/);
 assert.match(j,/":kind:" \+ messageType/);
 assert.match(act,/onChatReceipt\(String id, String peerNodeId\)/);
 assert.match(ui,/onReceipt\(id, peerId\)/);
 assert.match(app,/window\.NEST_ChatReceipt =/);
 assert.match(app,/venter på kvittering/);
 assert.match(app,/mottatt på enhet/);
});
test("v8 small chat payloads skip compression and never include old workspace history",()=>{
 const j=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(j,/byte\[\] plaintext = "secure_workspace"\.equals\(messageType\)/);
 assert.match(j,/\? gzip\(json\) : json\.getBytes\(StandardCharsets\.UTF_8\)/);
 assert.match(j,/workspace = new String\(opened, StandardCharsets\.UTF_8\)/);
 assert.match(j,/if \(opened\.length > 8192\) return/);
 assert.match(j,/Arrays\.fill\(opened, \(byte\) 0\)/);
});
test("a forged encrypted receipt for a different envelope kind fails AES-GCM",()=>{
 const key=randomBytes(32),iv=randomBytes(12);
 const context="NEST-LOCAL-V8-AEAD:two-phones:epoch-1:seq:13:kind:";
 const c=createCipheriv("aes-256-gcm",key,iv);
 c.setAAD(Buffer.from(context+"secure_chat"));
 const ct=Buffer.concat([c.update('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'),c.final()]);
 const tag=c.getAuthTag();
 const d=createDecipheriv("aes-256-gcm",key,iv);
 d.setAAD(Buffer.from(context+"secure_receipt"));d.setAuthTag(tag);
 assert.throws(()=>Buffer.concat([d.update(ct),d.final()]));
});
