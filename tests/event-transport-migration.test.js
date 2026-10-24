"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");
const read = name => fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const uid = n => "12345678-1234-1234-1234-"+String(n).padStart(12,"0");
function appContext(events = []) {
 const src=read("app.js");
 const a=src.indexOf("function queueLocalEvent("),b=src.indexOf("function persist(",a);
 assert.ok(a>=0 && b>a);
 const workspace={version:3,logicalCounter:0,updatedAt:"2026-10-24T00:00:00Z",tasks:[{
  id:uid(44),title:"Task",comments:[],createdAt:"2026-10-24T00:00:00Z",updatedAt:"2026-10-24T00:00:00Z"
 }],chat:[],outbox:events,deferredEvents:[]};
 const ctx={window:{},workspace,crypto:webcrypto,nowIso:()=>new Date().toISOString(),
  NESTCore:require("../nest-core.js"),persist:()=>ctx.writes++,
  writes:0,normalizeChat:v=>v&&typeof v.text==="string"?v:null,
  normalizeComment:v=>v&&typeof v.text==="string"?v:null};
 vm.createContext(ctx);
 vm.runInContext(src.slice(a,b)+"\nthis.create=queueLocalEvent;this.apply=applyTransportEvent;this.ack=acknowledgeLocalEvent;",ctx);
 return ctx;
}
test("historical messages and comments NEVER enter future GitHub snapshots",()=>{
 const sync=read("github-sync.js");
 const a=sync.indexOf("  function transportSnapshot() {");
 const b=sync.indexOf("\n  async function digestWorkspace",a);
 assert.ok(a>0&&b>a,"exercise actual snapshot serializer");
 const ctx={workspace:{
  version:3,logicalCounter:8,updatedAt:"2026-10-24T00:00:00Z",
  chat:[{id:uid(1),text:"TOP SECRET OLD CHAT"}],
  outbox:[{id:uid(2),secret:"SECRET OUTBOX"}],
  tasks:[{id:uid(3),title:"Current task",comments:[{text:"TOP SECRET OLD COMMENT"}],
    updatedAt:"2026-10-23T00:00:00Z"}]
 }};
 vm.createContext(ctx);
 vm.runInContext(sync.slice(a,b)+"\nthis.project=transportSnapshot;",ctx);
 const data=ctx.project(),wire=JSON.stringify(data);
 assert.deepEqual([...data.chat],[]);
 assert.deepEqual([...data.tasks[0].comments],[]);
 assert.equal("outbox" in data,false);
 for(const secret of ["TOP SECRET OLD CHAT","TOP SECRET OLD COMMENT","SECRET OUTBOX"])assert.equal(wire.includes(secret),false);
 assert.equal(data.tasks[0].title,"Current task");
 assert.equal(data.updatedAt,"2026-10-23T00:00:00Z");
 assert.match(sync,/encryptPayload\(\{ kind: "workspace", workspace: snapshot \}\)/);
});
test("inbound chat and comments are idempotent and stay local until queued by sender",()=>{
 const ctx=appContext(),id=uid(101),message={id,author:"Alice",text:"Hello",createdAt:"2026-10-24T01:00:00Z",clientId:"A"};
 assert.equal(ctx.apply({id,type:"chat",createdAt:message.createdAt,message}),true);
 assert.equal(ctx.apply({id,type:"chat",createdAt:message.createdAt,message}),true);
 assert.equal(ctx.workspace.chat.length,1);
 assert.equal(ctx.workspace.outbox.length,0);
 const c=uid(102),comment={id:c,author:"Alice",text:"One",createdAt:message.createdAt};
 assert.equal(ctx.apply({id:c,type:"task_comment",taskId:uid(44),createdAt:comment.createdAt,comment}),true);
 assert.equal(ctx.apply({id:c,type:"task_comment",taskId:uid(44),createdAt:comment.createdAt,comment}),true);
 assert.equal(ctx.workspace.tasks[0].comments.length,1);
 assert.equal(ctx.workspace.outbox.length,0);
 assert.ok(ctx.writes>=4);
});
test("malicious standalone events are rejected without workspace changes",()=>{
 const ctx=appContext();
 const bad=[
  {id:uid(4),type:"chat",createdAt:"date",message:{id:uid(4),text:"X".repeat(1001)}},
  {id:uid(5),type:"chat",createdAt:"date",message:{id:uid(888),text:"spoof"}},
  {id:uid(6),type:"task_comment",createdAt:"date",taskId:"unknown",comment:{id:uid(6),text:"x"}},
  {id:"../etc/passwd",type:"chat",createdAt:"date",message:{text:"x"}},
  {id:uid(7),type:"keys",createdAt:"date",message:{text:"x"}}
 ];
 for(const item of bad)assert.equal(ctx.apply(item),false);
 assert.equal(ctx.workspace.chat.length,0);
 assert.equal(ctx.workspace.tasks[0].comments.length,0);
 assert.equal(ctx.writes,0);
});
test("local authenticated ACK removes only a matching queued event ID",()=>{
 const id=uid(91),ctx=appContext([{id,type:"chat",createdAt:"2026-10-24T00:00:00Z"}]);
 assert.equal(ctx.ack(uid(90)),false);
 assert.equal(ctx.workspace.outbox.length,1);
 assert.equal(ctx.ack(id),true);
 assert.equal(ctx.workspace.outbox.length,0);
 assert.equal(ctx.ack(id),false);
 assert.equal(ctx.writes,1);
});
test("GitHub event publishing preserves outbox on error and deletes only on confirmed post",async()=>{
 const src=read("github-sync.js");
 const start=src.indexOf("  async function publishPendingEvents() {");
 const end=src.indexOf("\n  async function attemptPublish()",start);
 assert.ok(start>0&&end>start,"actual outbound event publisher");
 const event={id:uid(22),type:"chat",createdAt:"2026-10-24T01:00:00Z",message:{id:uid(22),text:"NEW ONLY"}};
 const ctx={workspace:{outbox:[event]},window:{NESTSecurity:{requireForwardSecretTransport:()=>true}},
  encryptPayload:async data=>({iv:"AAAAAAAAAAAAAAAA",data:Buffer.from(JSON.stringify(data)).toString("base64")}),
  roomId:"r",MAX_CHUNK:44000,COMMENT_MARKER:"<!-- NEST-E2EE-V1 -->",repoOwner:"owner",repoName:"private",issueNumber:1,
  crypto:webcrypto,encodeURIComponent,JSON,persist:()=>ctx.saves++,saves:0,posts:[],
  fail:true,api:async (route,options)=>{
   if(ctx.fail)throw Error("simulated 503");
   ctx.posts.push({route,body:JSON.parse(options.body).body});
   return {id:123};
  }};
 vm.createContext(ctx);
 vm.runInContext(src.slice(start,end)+"\nthis.send=publishPendingEvents;",ctx);
 await assert.rejects(ctx.send(),/simulated 503/);
 assert.equal(ctx.workspace.outbox.length,1);
 ctx.fail=false;
 await ctx.send();
 assert.equal(ctx.workspace.outbox.length,0);
 assert.equal(ctx.posts.length,1);
 assert.equal(ctx.saves,1);
 const submitted=JSON.parse(ctx.posts[0].body.split("\n").slice(1).join("\n"));
 const inner=JSON.parse(Buffer.from(submitted.data,"base64").toString());
 assert.equal(inner.kind,"event");
 assert.equal(inner.event.message.text,"NEW ONLY");
});
test("local transport resends pending events until encrypted ACK without broadcasting chat history",()=>{
 const ui=read("ux-v06.js"),java=read("android/app/src/main/java/no/blckswan/nestchannel/LocalSyncManager.java");
 assert.match(ui,/if \(localPeers > 0\)/);
 assert.match(ui,/window\.NativeLocal\?\.sendWorkspace\?\.\(JSON\.stringify\(\{kind: "event", event\}\)\)/);
 assert.match(ui,/window\.NativeLocal\?\.sendWorkspace\?\.\(JSON\.stringify\(\{kind: "ack", id: data\.event\.id\}\)\)/);
 assert.match(ui,/acknowledgeLocalEvent\(data\.id\)/);
 assert.match(ui,/localRetryTimer = setInterval/);
 assert.match(ui,/tasks: \(data\.tasks \|\| \[\]\)\.map\(task => \(\{\.\.\.task, comments: \[\]\}\)\)/);
 assert.match(java,/transientPacket = "event"\.equals\(kind\) \|\| "ack"\.equals\(kind\)/);
 assert.match(java,/if \(!transientPacket\) lastWorkspace = json/);
});
test("strict safety gate remains blocked for static-key GitHub events",()=>{
 const code=read("github-sync.js"),policy=require("../high-threat.js");
 assert.match(code,/requireForwardSecretTransport\?\.\("github_workspace"\)/);
 assert.throws(()=>policy.requireForwardSecretTransport("github_workspace"),/forward secrecy/);
 assert.equal(JSON.parse(read("SECURITY-READINESS.json")).release_blocked,true);
});

test("task comment arriving before its task is durably deferred",()=>{
 const ctx=appContext();
 ctx.workspace.tasks.length=0;
 const id=uid(190),when="2026-10-24T12:00:00Z";
 const ev={id,type:"task_comment",createdAt:when,taskId:uid(44),comment:{id,author:"A",text:"delayed",createdAt:when}};
 assert.equal(ctx.apply(ev),true);
 assert.equal(ctx.apply(ev),true);
 assert.equal(ctx.workspace.deferredEvents.length,1);
 assert.equal(ctx.workspace.tasks.length,0);
 assert.ok(ctx.writes>=1);
 const src=read("app.js");
 assert.match(src,/const pending = \[\.\.\.workspace\.deferredEvents\]/);
 assert.match(src,/applyTransportEvent\(event\)/);
});
test("GitHub must return persisted numeric comment ID before clearing encrypted outbox",()=>{
 const code=read("github-sync.js");
 const segment=code.slice(code.indexOf("async function publishPendingEvents"),code.indexOf("async function attemptPublish"));
 assert.match(segment,/Number\.isSafeInteger\(saved\?\.id\)/);
 assert.match(segment,/throw new Error\("GitHub bekreftet ikke lagret hendelse/);
 assert.ok(segment.indexOf("throw new Error") < segment.indexOf("workspace.outbox = workspace.outbox.filter"));
});
