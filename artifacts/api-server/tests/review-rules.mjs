// Real database and HTTP routes in an isolated schema; provider responses deterministic.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const pg = createRequire(resolve("lib/db/package.json"))("pg");
const schemaName = `test_reviews_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const temp = await mkdtemp(join(tmpdir(), "reviews-"));
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of ["webhooks","inbox_events","app_settings","user_preferences","understanding_jobs","active_actions","message_outbox","review_rules","review_runs"])
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: { resolveDir: resolve("artifacts/api-server"), loader: "ts", contents: `
import assert from "node:assert/strict";
import express from "express";
import {db,pool,appSettingsTable,eventsTable,jobsTable,actionsTable,reviewRulesTable as rules,reviewRunsTable as runs} from "@workspace/db";
import organizer from "./src/routes/organizer";
import {processNextReview,scheduleReviews,startReviewWorker} from "./src/lib/review-worker";
import {nextReviewTime,assertAcyclic} from "./src/lib/review-scheduling";
import {eq,and,sql} from "drizzle-orm";
export async function check(){
const app=express();app.use(express.json());app.use("/api",organizer);
app.use((e,req,res,next)=>{console.error(e);res.status(500).json({error:e.message});});
const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
const base="http://127.0.0.1:"+server.address().port+"/api";
const api=(path,method="GET",data,owner="owner")=>fetch(base+path,{method,headers:{"x-test-owner":owner,"content-type":"application/json"},...(data===undefined?{}:{body:JSON.stringify(data)})});
const json=async(path,method="GET",data)=>{const r=await api(path,method,data);const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};
const now=new Date(), ago=n=>new Date(now.getTime()-n*60000);
const input={name:"Review",prompt:"Connect related thoughts.",enabled:false,trigger:"manual",quietMinutes:2,intervalHours:1,dailyTime:"18:00",timezone:"America/Los_Angeles",lookbackHours:24,includeMessages:true,includeTasks:true,inputRuleIds:[],output:"report"};
const getRun=async id=>(await db.select().from(runs).where(eq(runs.id,id)))[0];
const note=async(id,minutes,text="A thought about the launch",done=true)=>db.insert(eventsTable).values({id,ownerId:"owner",kind:"json",payload:{},transcription:text,receivedAt:ago(minutes),actionsInitializedAt:done?now:null});
let stop;
try{
  assert.equal((await api("/rules","GET",undefined,"")).status,401);
  await json("/settings");await db.update(appSettingsTable).set({allowSignups:true}).where(eq(appSettingsTable.id,1));
  const first=await json("/rules","POST",input);
  assert.equal((await api("/rules/"+first.id,"GET",undefined,"other")).status,404);
  assert.equal((await api("/rules/"+first.id,"PUT",input,"other")).status,404);
  assert.equal((await api("/rules/"+first.id,"DELETE",undefined,"other")).status,404);
  assert.equal((await api("/rules","POST",{...input,timezone:"nope"})).status,400);
  assert.equal((await api("/rules","POST",{...input,quietMinutes:0})).status,400);
  const second=await json("/rules","POST",{...input,inputRuleIds:[first.id]});
  assert.equal((await api("/rules/"+first.id,"PUT",{...input,inputRuleIds:[second.id]})).status,400);
  assert.equal((await api("/rules/"+first.id,"DELETE")).status,409);
  assert.equal((await api("/rules","POST",{...input,inputRuleIds:[first.id]}, "other")).status,400);
  assert.throws(()=>assertAcyclic("a",["b"],new Map([["b",["a"]]])));
  assert.equal(nextReviewTime({...input,enabled:true,trigger:"daily",dailyTime:"09:00"},new Date("2026-03-07T18:00:00Z")).toISOString(),"2026-03-08T16:00:00.000Z");
  assert.equal(nextReviewTime({...input,enabled:true,trigger:"daily",dailyTime:"02:30"},new Date("2026-03-07T18:00:00Z")).toISOString(),"2026-03-08T10:00:00.000Z");
  console.log("PASS: rule CRUD validation, account isolation, dependency cycles and local-time DST schedules");
  await note("n1",10);await note("n2",5);
  await db.insert(actionsTable).values({id:"t1",ownerId:"owner",sourceEventId:"n1",title:"Launch email",timezone:"UTC"});
  const quiet=await json("/rules","POST",{...input,trigger:"quiet",enabled:true});
  await db.update(rules).set({batchCursor:ago(11)}).where(eq(rules.id,quiet.id));
  await scheduleReviews(ago(4)); // Only one minute quiet: not ready.
  assert.equal((await json("/rules/"+quiet.id+"/runs")).length,0);
  await note("n3",3);
  await scheduleReviews(ago(2)); // New note reset timer.
  assert.equal((await json("/rules/"+quiet.id+"/runs")).length,0);
  await scheduleReviews(now);await scheduleReviews(now);
  assert.equal((await json("/rules/"+quiet.id+"/runs")).length,1);
  const qrun=(await json("/rules/"+quiet.id+"/runs"))[0];
  await Promise.all([processNextReview(),processNextReview()]);
  assert.equal((await getRun(qrun.id)).status,"completed");
  assert.equal(globalThis.calls,1);
  assert.equal(globalThis.lastContext.messages.length,3);
  assert.equal(globalThis.lastPrompt,input.prompt);
  await scheduleReviews(now);
  assert.equal((await json("/rules/"+quiet.id+"/runs")).length,1);
  console.log("PASS: burst quiet-period reset, exactly-once enqueue and concurrent claim protection");
  const original=await db.select().from(jobsTable);
  await note("wait",1,"Do this",false);
  const manual=await json("/rules/"+first.id+"/runs","POST");
  await processNextReview();
  assert.equal((await getRun(manual.id)).status,"waiting");
  assert.deepEqual(await db.select().from(jobsTable),original); // review must not create/modify core jobs
  await db.insert(jobsTable).values({eventId:"wait",ownerId:"owner",status:"failed"});
  await processNextReview();
  assert.equal((await getRun(manual.id)).status,"completed");
  console.log("PASS: review waits for extraction without modifying the initial extraction queue");
  const overview=await json("/rules","POST",{...input,output:"overview"});
  let run=await json("/rules/"+overview.id+"/runs","POST");
  await processNextReview();
  let updated=await json("/rules/"+overview.id);
  assert.ok(updated.overview.includes("Review result"));
  await json("/rules/"+overview.id+"/overview","PUT",{text:"My corrected overview",revision:updated.revision});
  assert.equal((await api("/rules/"+overview.id+"/overview","PUT",{text:"stale",revision:updated.revision})).status,409);
  run=await json("/rules/"+overview.id+"/runs","POST");await processNextReview();
  assert.equal(globalThis.lastContext.previousOverview,"My corrected overview");
  const chained=await json("/rules","POST",{...input,inputRuleIds:[overview.id],includeMessages:false,includeTasks:false});
  run=await json("/rules/"+chained.id+"/runs","POST");await processNextReview();
  assert.ok(globalThis.lastContext.reviews.length>=2);
  assert.equal(globalThis.lastContext.messages.length,0);
  assert.equal((await getRun(run.id)).status,"completed");
  console.log("PASS: editable rolling overview revisions and bounded inputs from other rules");
  const taskRule=await json("/rules","POST",{...input,output:"tasks"});
  globalThis.changes=[{taskId:"t1",title:"Send launch email",setDueDate:true,dueAt:"2027-01-01T10:00:00Z",mergeIntoId:null,sourceIds:["n1"]}];
  run=await json("/rules/"+taskRule.id+"/runs","POST");await processNextReview();
  assert.equal((await getRun(run.id)).status,"completed");
  assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.id,"t1")))[0].title,"Send launch email");
  await json("/rules/"+taskRule.id+"/runs/"+run.id+"/undo","POST");
  assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.id,"t1")))[0].title,"Launch email");
  run=await json("/rules/"+first.id+"/runs","POST");await processNextReview();
  assert.equal((await getRun(run.id)).status,"failed"); // report mode cannot edit tasks
  await db.update(actionsTable).set({editedAt:new Date(),title:"My manual title"}).where(eq(actionsTable.id,"t1"));
  run=await json("/rules/"+taskRule.id+"/runs","POST");await processNextReview();
  assert.equal((await getRun(run.id)).status,"failed");
  assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.id,"t1")))[0].title,"My manual title");
  await db.update(actionsTable).set({editedAt:null}).where(eq(actionsTable.id,"t1"));
  await db.insert(actionsTable).values({id:"t2",ownerId:"owner",sourceEventId:"n2",title:"Duplicate launch email",timezone:"UTC"});
  globalThis.changes=[{taskId:"t2",title:null,setDueDate:false,dueAt:null,mergeIntoId:"t1",sourceIds:["n1","n2"]}];
  run=await json("/rules/"+taskRule.id+"/runs","POST");await processNextReview();
  assert.equal((await getRun(run.id)).status,"completed");
  assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.id,"t2")))[0].status,"dismissed");
  await db.update(actionsTable).set({title:"Newer edit"}).where(eq(actionsTable.id,"t2"));
  assert.equal((await api("/rules/"+taskRule.id+"/runs/"+run.id+"/undo","POST")).status,409);
  console.log("PASS: permission-limited task updates, undo, manual edit protection and reversible duplicate reconciliation");
  globalThis.changes=[];
  let release,entered;
  const started=new Promise(r=>entered=r);
  globalThis.gate=()=>{entered();return new Promise(r=>release=r)};
  run=await json("/rules/"+first.id+"/runs","POST");
  const work=processNextReview();await started;
  await json("/rules/"+first.id,"PUT",{...input,prompt:"Changed while running"});
  release();await work;globalThis.gate=null;
  assert.equal((await getRun(run.id)).status,"cancelled");
  assert.equal((await getRun(run.id)).report,null);
  console.log("PASS: edits fence in-flight old rule results");
  // A deletion while the provider runs must fence the result, not leave a ghost.
  const doomed=await json("/rules","POST",input);
  let releaseDelete,enteredDelete;
  const deleting=new Promise(r=>enteredDelete=r);
  globalThis.gate=()=>{enteredDelete();return new Promise(r=>releaseDelete=r)};
  run=await json("/rules/"+doomed.id+"/runs","POST");
  const deletingWork=processNextReview();await deleting;
  assert.equal((await api("/rules/"+doomed.id,"DELETE")).status,204);
  releaseDelete();await deletingWork;globalThis.gate=null;
  assert.equal(await getRun(run.id),undefined);
  assert.ok((await db.select().from(eventsTable)).length>=4);
  // Retryable provider failures are durable, bounded, and never touch extraction.
  globalThis.providerError={status:429};
  run=await json("/rules/"+first.id+"/runs","POST");
  await processNextReview();
  assert.equal((await getRun(run.id)).status,"pending");
  await db.update(runs).set({availableAt:new Date(0)}).where(eq(runs.id,run.id));
  globalThis.providerError=null;
  await processNextReview();
  assert.equal((await getRun(run.id)).status,"completed");
  assert.equal((await getRun(run.id)).attempts,2);
  const burstBefore=(await json("/rules/"+quiet.id+"/runs")).length;
  await note("lone",-1);await scheduleReviews(new Date(now.getTime()+4*60000));
  assert.equal((await json("/rules/"+quiet.id+"/runs")).length,burstBefore);
  console.log("PASS: deletion fences, durable provider retry and no single-message batch rollup");
  const scheduled=await json("/rules","POST",{...input,enabled:true,trigger:"hourly"});
  await db.update(rules).set({nextRunAt:ago(120)}).where(eq(rules.id,scheduled.id));
  await scheduleReviews();await scheduleReviews();
  assert.equal((await json("/rules/"+scheduled.id+"/runs")).length,1); // restart coalesces missed periods
  await processNextReview();
  stop=startReviewWorker();
  run=await json("/rules/"+first.id+"/runs","POST");
  for(let i=0;i<100&&(await getRun(run.id)).status!=="completed";i++)await new Promise(r=>setTimeout(r,30));
  assert.equal((await getRun(run.id)).status,"completed");
  stop();stop=undefined;
  console.log("PASS: missed-schedule recovery and PostgreSQL notification-driven execution");
}finally{stop?.();await new Promise(r=>server.close(r));await pool.end();}
}
` },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent", external: ["pg-native"],
    plugins: [{ name: "isolated", setup(b) {
      b.onResolve({filter:/^@workspace\/db$/},()=>({path:"db",namespace:"fixture"}));
      b.onResolve({filter:/^@clerk\/express$/},()=>({path:"auth",namespace:"fixture"}));
      b.onResolve({filter:/^@workspace\/integrations-openai-ai-server$/},()=>({path:"ai",namespace:"fixture"}));
      b.onLoad({filter:/^auth$/,namespace:"fixture"},()=>({contents:'export const getAuth=req=>({userId:req.headers["x-test-owner"]||null});'}));
      b.onLoad({filter:/^db$/,namespace:"fixture"},()=>({resolveDir:resolve("lib/db"),contents:`import pg from "pg";import {drizzle} from "drizzle-orm/node-postgres";import * as schema from "./src/schema";export * from "./src/schema";export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:"-c search_path=${schemaName}"});export const db=drizzle(pool,{schema});`}));
      b.onLoad({filter:/^ai$/,namespace:"fixture"},()=>({contents:`
        globalThis.calls=0;
        const create=async request=>{
          globalThis.calls++;
          globalThis.lastContext=JSON.parse(request.messages.at(-1).content);
          globalThis.lastPrompt=request.messages[1].content;
          if(globalThis.gate)await globalThis.gate();
          if(globalThis.providerError)throw globalThis.providerError;
          const context=globalThis.lastContext;
          return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({report:"Review result "+globalThis.calls,sourceIds:[...context.messages,...context.tasks,...context.reviews].map(x=>x.id),changes:globalThis.changes??[]})}}]};
        };export const openai={withOptions:()=>({chat:{completions:{create}}})};
      `}));
    } }],
  });
  await createRequire(import.meta.url)(outfile).check();
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end(); await rm(temp,{recursive:true,force:true});
}
