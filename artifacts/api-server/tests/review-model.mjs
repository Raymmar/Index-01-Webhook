// Opt-in live structured-output contract check; does not read/write account data.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const dir = await mkdtemp(join(tmpdir(), "review-model-"));
try {
  const outfile=join(dir,"check.cjs");
  await build({stdin:{resolveDir:resolve("artifacts/api-server"),loader:"ts",contents:`
import assert from "node:assert/strict";
import {reviewWithAI} from "./src/lib/review-ai";
export async function check(){
const context={
windowStart:"2026-11-21T16:00:00Z",windowEnd:"2026-11-21T17:00:00Z",timezone:"America/Los_Angeles",
previousOverview:null,
messages:[{id:"m1",receivedAt:"2026-11-21T16:01:00Z",text:"I am exploring how voice notes connect thoughts between meetings."},{id:"m2",receivedAt:"2026-11-21T16:03:00Z",text:"The same voice notes project needs a daily review, not another task list."}],
tasks:[],reviews:[]};
const result=await reviewWithAI({prompt:"Summarize the common theme and distinguish stated goals from suggestions. Cite the messages. Do not invent tasks.",output:"report"},context,"replit","gpt-5-mini");
assert.ok(result.report.length>30);
assert.deepEqual(result.changes,[]);
assert.ok(result.sourceIds.length>0&&result.sourceIds.every(id=>["m1","m2"].includes(id)));
console.log("PASS: live review prompt produces a source-linked report without task changes");
}
`},outfile,bundle:true,platform:"node",format:"cjs",logLevel:"silent",external:["pg-native"]});
  await createRequire(import.meta.url)(outfile).check();
}finally{await rm(dir,{recursive:true,force:true});}
