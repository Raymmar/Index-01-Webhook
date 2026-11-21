import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "extraction-prompts-"));
const live = process.argv.includes("--live");
try {
  const output = join(dir, "checks.cjs");
  await build({
    stdin: { resolveDir: resolve("artifacts/api-server"), loader: "ts", contents: `
      import assert from "node:assert/strict";
      import { extractActions } from "./src/lib/understanding";
      import { buildExtractionMessages, messageTimeContext, extractionSystemPrompt } from "./src/lib/extraction-prompt";
      import { defaultInstructions, resolveInstructions, renderSkill } from "./src/lib/extraction-skill";
      export async function check(live) {
        const at = new Date("2026-11-21T16:00:00Z"), timezone = "America/Los_Angeles";
        const base = {receivedAt:at,recordedAt:new Date("2020-01-01T00:00:00Z"),timezone,provider:"replit",model:"gpt-5-mini"};
        const fields = {...defaultInstructions,personalContext:"Sam is my editor.", titleStyle:"Start titles with EDITOR:"};
        const request = buildExtractionMessages("Yesterday I met Sam. Remind me next Monday to follow up.",at,timezone,fields);
        assert.equal(request[0].content, extractionSystemPrompt);
        assert.ok(!request[0].content.includes("morning means"));
        assert.equal(request[1].content,renderSkill(fields));
        assert.equal(resolveInstructions({personalContext:""}).personalContext,"");
        assert.equal(JSON.parse(request[2].content).messageContext.receivedAt,at.toISOString());
        assert.equal(messageTimeContext(at,timezone).calendar.nextCalendarWeekMonday,"2026-11-23 Monday");
        assert.equal(messageTimeContext(new Date("2026-11-23T16:00:00Z"),timezone).calendar.nextCalendarWeekMonday,"2026-11-30 Monday");
        assert.equal(messageTimeContext(new Date("2026-12-31T23:00:00Z"),timezone).calendar.nextCalendarWeekMonday,"2027-01-04 Monday");
        assert.equal(messageTimeContext(new Date("2026-11-23T01:00:00Z"),timezone).calendar.nextCalendarWeekMonday,"2026-11-23 Monday");
        assert.equal(messageTimeContext(new Date("2027-03-13T16:00:00Z"),timezone).calendar.sevenCalendarDaysLater,"2027-03-20 Saturday");
        if (!live) {
          const transcript = "Yesterday I met Sam. Remind me next Monday at 9 AM to follow up.";
          globalThis.resultItems = [{title:"Follow up with Sam",sourceAction:transcript,localDueAt:"2026-11-23T09:00",minutesFromRecording:null,originalTimeText:"next Monday at 9 AM",needsReview:false}];
          const items = await extractActions({...base,transcript,instructions:fields});
          assert.equal(items[0].dueAt.toISOString(),"2026-11-23T17:00:00.000Z");
          assert.ok(globalThis.request.messages[1].content.includes("Sam is my editor."));
          assert.equal(JSON.parse(globalThis.request.messages.at(-1).content).messageContext.receivedAt,at.toISOString());
          globalThis.resultItems[0].localDueAt="2026-11-20T09:00";
          await assert.rejects(()=>extractActions({...base,transcript}), /before message receipt/);
          globalThis.resultItems[0].localDueAt=null;
          globalThis.resultItems[0].minutesFromRecording=30;
          globalThis.resultItems[0].originalTimeText="in 30 minutes";
          globalThis.resultItems[0].sourceAction="Call Sam in 30 minutes.";
          assert.equal((await extractActions({...base,transcript:"Call Sam in 30 minutes."}))[0].dueAt.toISOString(),"2026-11-21T16:30:00.000Z");
          console.log("PASS: minimal system contract, editable skill composition, receipt anchor, timezone/week/year/DST calendar context and rejection of backwards deadlines");
          return;
        }
        const transcript = "Yesterday I met Sam. Remind me next Monday at 9 AM to follow up with Sam. Remind me next week to review the budget. Remind me in a week to renew the permit. Yesterday I finished the report; remind me tomorrow at 2 PM to email that report to Lee.";
        const items = await extractActions({...base,transcript});
        assert.equal(items.length,4,"one task per requested action");
        const due = word => items.find(item=>item.title.toLowerCase().includes(word))?.dueAt?.toISOString();
        assert.equal(due("sam"),"2026-11-23T17:00:00.000Z");
        assert.equal(due("budget"),"2026-11-23T16:00:00.000Z");
        assert.equal(due("permit"),"2026-11-28T16:00:00.000Z");
        assert.equal(due("report"),"2026-11-22T22:00:00.000Z");
        console.log("PASS: live model distinguishes yesterday context from next Monday, next week, a week out and tomorrow deadlines");
      }
    ` },
    outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    plugins: live ? [] : [{
      name:"mock-provider",
      setup(builder) {
        builder.onResolve({filter:/^@workspace\/integrations-openai-ai-server$/},()=>({path:"provider",namespace:"fixture"}));
        builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:`
          export const openai={withOptions:()=>({chat:{completions:{create:async request=>{
            globalThis.request=request;
            return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({items:globalThis.resultItems})}}]};
          }}}})};
        `}));
      },
    }],
  });
  const { createRequire } = await import("node:module");
  await createRequire(import.meta.url)(output).check(live);
} finally { await rm(dir,{recursive:true,force:true}); }
