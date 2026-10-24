"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const core=require("../nest-core.js");
const uid=n=>"12345678-1234-1234-1234-"+String(n).padStart(12,"0");
test("task changes are field-level envelopes, not historical task snapshots",()=>{
 const app=read("app.js"),gh=read("github-sync.js");
 assert.match(app,/function queueTaskPatch\(task, fields\)/);
 assert.match(app,/patch\[field\] = \{value:task\[field\],clock:task\.fieldUpdatedAt\[field\]\}/);
 assert.match(app,/queueLocalEvent\("task_patch"/);
 assert.match(gh,/if\(!\["chat","task_comment","task_patch"\]\.includes\(event\.type\)\)continue/);
 assert.ok(gh.includes("NEST-FS1-ROOM:"));
 assert.match(gh,/await fsPost\(JSON\.parse\(current\.fsEnvelope\)\)/);
});
test("real task patch producer excludes unchanged historical title",()=>{
 const src=read("app.js");
 const a=src.indexOf("function queueTaskPatch(task, fields) {"),b=src.indexOf("function applyTransportEvent(event) {",a);
 assert.ok(a>0&&b>a);
 const sent=[];
 const task={
  id:uid(42),createdAt:"2026-10-24T00:00:00Z",title:"OLD TITLE NEVER RESENT",
  done:true,comments:[{text:"OLD SECRET COMMENT"}],
  fieldUpdatedAt:{done:"L:0000000000000003:node",title:"L:0000000000000001:node"}
 };
 const context={NESTCore:core,queueLocalEvent:(t,d)=>sent.push({t,d}),el:{statusText:{textContent:""}}};
 vm.createContext(context);
 vm.runInContext(src.slice(a,b)+"\nthis.queue=queueTaskPatch;",context);
 context.queue(task,["done"]);
 assert.equal(sent.length,1);
 assert.deepEqual(Object.keys(sent[0].d.patch),["done"]);
 assert.equal(JSON.stringify(sent).includes("OLD TITLE"),false);
 assert.equal(JSON.stringify(sent).includes("OLD SECRET"),false);
});
test("authenticated inbound task delta updates only changed field",()=>{
 const src=read("app.js");
 const a=src.indexOf("function applyTransportEvent(event) {"),b=src.indexOf("function acknowledgeLocalEvent(id) {",a);
 assert.ok(a>=0&&b>a);
 const task={id:uid(42),title:"Original",assignee:"Alice",done:false,deleted:false,labels:[],dependsOn:[],comments:[],
  createdAt:"2026-10-24T00:00:00Z",updatedAt:"2026-10-24T00:00:00Z",
  fieldUpdatedAt:Object.fromEntries(core.TASK_FIELDS.map(f=>[f,"L:0000000000000001:node"]))};
 const ctx={workspace:{tasks:[task],chat:[],outbox:[],deferredEvents:[]},NESTCore:core,
  normalizeTask:x=>x,normalizeChat:x=>x,normalizeComment:x=>x,persist:()=>{ctx.writes++;},writes:0};
 vm.createContext(ctx);vm.runInContext(src.slice(a,b)+"\nthis.apply=applyTransportEvent;",ctx);
 const e={id:uid(78),type:"task_patch",createdAt:"2026-10-24T12:00:00Z",taskId:task.id,
  patch:{done:{value:true,clock:"L:0000000000000003:peer"}}};
 assert.equal(ctx.apply(e),true);
 assert.equal(task.done,true);
 assert.equal(task.title,"Original");
 assert.equal(task.assignee,"Alice");
 assert.equal(task.comments.length,0);
 assert.equal(ctx.writes,1);
});
test("strict FS mailbox never accepts legacy static-key comment markers",()=>{
 const js=read("github-sync.js");
 assert.match(js,/const FS_MARKER = "<!-- NEST-GH-FS1 -->"/);
 assert.match(js,/if\(fsMode\)\{[\s\S]*?fsPoll\(\)/);
 assert.match(js,/await fsPublishBundle\(\)/);
 assert.match(js,/roomKey=null/);
});
