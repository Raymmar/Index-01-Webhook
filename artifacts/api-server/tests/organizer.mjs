// Isolated-schema integration regression: uses real PostgreSQL, real routes,
// and deterministic mocked provider responses. No existing user data is changed.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const pg = createRequire(resolve("lib/db/package.json"))("pg");

const schemaName = `test_organizer_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const temp = await mkdtemp(join(tmpdir(), "organizer-"));
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of ["webhooks", "inbox_events", "app_settings", "user_preferences", "understanding_jobs", "action_items", "active_actions", "message_outbox"]) {
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: {
      contents: `
import assert from "node:assert/strict";
import express from "express";
import { db, pool, appSettingsTable, eventsTable, jobsTable, itemsTable, actionsTable, messageOutboxTable } from "@workspace/db";
import organizer from "./src/routes/organizer";
import inbox from "./src/routes/inbox";
import receive from "./src/routes/receive";
import { accountFor } from "./src/lib/account";
import { processNextJob, startUnderstandingWorker } from "./src/lib/understanding-worker";
import { dispatchNextMessage, startMessageDispatcher } from "./src/lib/message-dispatcher";
import { resolveDue, extractActions } from "./src/lib/understanding";
import { migrateUnifiedItems } from "./src/lib/unified-items";
import { processingFailure } from "./src/lib/ai-models";
import { audioFile } from "./src/lib/recording-storage";
import { eq, sql } from "drizzle-orm";
export async function check() {
  const app = express();
  app.use((req, _res, next) => { req.log = { warn() {} }; next(); });
  app.use("/api", receive);
  app.use(express.json());
  app.use("/api", organizer);
  app.use("/api", inbox);
  app.use((err, _req, res, _next) => { console.error(err.name); res.status(500).end(); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const api = (path, method = "GET", identity = "owner", data) => fetch(base + path, {
    method, headers: { "x-test-owner": identity, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  // A separate DB connection models the listener used by another API instance.
  const listener = await pool.connect();
  await listener.query("LISTEN ring_inbox_changed");
  const notifications = [];
  listener.on("notification", message => {
    if (message.channel === "ring_inbox_changed") notifications.push(message.payload);
  });
  async function notifiedMutation(path, method, data) {
    notifications.length = 0;
    const response = await api(path, method, "owner", data);
    for (let attempt = 0; attempt < 50 && !notifications.includes("owner"); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(notifications.includes("owner"), method + " must notify the owning account");
    assert.ok(!notifications.includes("other"), "Mutation must not notify a different account");
    return response;
  }
  try {
    assert.equal((await api("/settings", "GET", "")).status, 401);
    const [a,b] = await Promise.all([accountFor("owner"), accountFor("other")]);
    const [config] = await db.select().from(appSettingsTable);
    assert.ok(["owner", "other"].includes(config.ownerId));
    assert.equal((await db.select().from(appSettingsTable)).length, 1);
    // Set isolated fixture identity so subsequent checks are deterministic.
    await db.update(appSettingsTable).set({ ownerId: "owner" });
    assert.equal((await (await api("/settings")).json()).isOwner, true);
    assert.ok((await (await api("/settings")).json()).availableModels.includes("gpt-5.6-terra"));
    assert.equal((await api("/settings", "PATCH", "owner", { aiModel: "gpt-5.6" })).status, 400);
    assert.equal((await (await api("/settings")).json()).aiModel, "gpt-5-mini");
    assert.equal(processingFailure({ status: 400, code: "UNSUPPORTED_MODEL", message: "private content" }).retry, false);
    assert.ok(!processingFailure({ status: 400, code: "UNSUPPORTED_MODEL", message: "private content" }).message.includes("private content"));
    assert.equal(processingFailure({ status: 429 }).retry, true);
    assert.equal((await (await api("/settings", "GET", "other")).json()).allowed, false);
    assert.equal((await api("/events", "GET", "other")).status, 403);
    assert.equal((await api("/settings", "PATCH", "owner", { timezone: "Invalid/Zone" })).status, 400);
    assert.equal((await api("/settings", "PATCH", "owner", { timezone: "America/Los_Angeles", allowSignups: true })).status, 200);
    const initialPrompts = await (await api("/prompts")).json();
    assert.equal(typeof initialPrompts.instructions.dateRules, "string");
    assert.equal((await api("/prompts", "GET", "")).status, 401);
    const customPrompts = {...initialPrompts.instructions, personalContext:"My project is the garden.", titleStyle:"Use short verb-first titles."};
    assert.equal((await notifiedMutation("/prompts", "PUT", customPrompts)).status, 200);
    assert.deepEqual((await (await api("/prompts")).json()).instructions, customPrompts);
    assert.equal((await (await api("/prompts", "GET", "other")).json()).instructions.personalContext, "");
    assert.equal((await api("/prompts", "PUT", "owner", {...customPrompts, taskRules:"x".repeat(6001)})).status, 400);
    assert.equal((await api("/prompts", "PUT", "owner", {personalContext:"partial"})).status, 400);
    assert.equal((await api("/prompts", "PUT", "owner", {...customPrompts, personalContext:""})).status, 200);
    assert.equal((await (await api("/prompts")).json()).instructions.personalContext, "");
    await api("/prompts", "PUT", "owner", customPrompts);
    // Personal confirmation preferences persist across sessions, remain isolated,
    // and notify the account's other connected clients.
    for (const key of ["skipTaskDismissConfirmation", "skipTaskDeleteConfirmation", "skipMessageDeleteConfirmation"]) {
      assert.equal((await (await api("/settings")).json())[key], false);
      assert.equal((await notifiedMutation("/settings", "PATCH", { [key]: true })).status, 200);
      assert.equal((await (await api("/settings")).json())[key], true);
      assert.equal((await (await api("/settings", "GET", "other")).json())[key], false);
    }
    assert.equal((await api("/settings", "PATCH", "other", { skipTaskDeleteConfirmation: true })).status, 200);
    assert.equal((await api("/settings", "PATCH", "owner", { skipTaskDeleteConfirmation: "true" })).status, 400);
    assert.equal((await notifiedMutation("/settings", "PATCH", { skipTaskDeleteConfirmation: false })).status, 200);
    const preferences = await (await api("/settings")).json();
    assert.equal(preferences.skipTaskDeleteConfirmation, false);
    assert.equal(preferences.skipTaskDismissConfirmation, true);
    assert.equal(preferences.skipMessageDeleteConfirmation, true);
    assert.equal((await (await api("/settings", "GET", "other")).json()).allowed, true);
    assert.equal((await api("/settings", "PATCH", "other", { allowSignups: false })).status, 403);
    assert.equal((await api("/settings", "PATCH", "other", { timezone: "Europe/London" })).status, 200);
    if (process.argv.includes("--sync-only")) {
      const created = await api("/items", "POST", "owner", { title: "Cross-client sync fixture" });
      assert.equal(created.status, 201);
      const task = await created.json();
      assert.equal((await notifiedMutation("/items/" + task.id, "PATCH", { status: "completed" })).status, 200);
      assert.equal((await (await api("/organizer")).json()).items.find(i => i.id === task.id).status, "completed");
      assert.equal((await notifiedMutation("/items/" + task.id, "DELETE")).status, 204);
      assert.equal((await (await api("/organizer")).json()).items.some(i => i.id === task.id), false);
      console.log("PASS: completion/deletion notify a separate connection, target the owner, and update subsequent dashboard reads");
      return;
    }
    const created = await api("/webhooks", "POST", "owner", { name: "AI fixture" });
    assert.equal(created.status, 201);
    const hook = await created.json();
    const delivery = await fetch(base + hook.webhook.path.slice(4), {
      method: "POST", headers: { "content-type": "application/json", authorization: hook.headerValue },
      body: JSON.stringify({ recordedAt: Date.parse("2026-11-15T16:58:00Z"),
        transcription: "Add update the landing page to my task list. Also add buy printer paper to my task list. Remind me in 30 minutes to call Sam. Remind me tomorrow at 9 AM to send the report. Remind me tomorrow to check the plants. My idea is that an annual plan might be useful." }),
    });
    assert.equal(delivery.status, 201);
    const receipt = await delivery.json();
    await db.update(eventsTable).set({ receivedAt: new Date("2026-11-15T16:58:00Z") }).where(eq(eventsTable.id, receipt.id));
    assert.equal((await api("/events/" + receipt.id + "/understand", "POST", "other")).status, 404);
    assert.equal((await db.select().from(jobsTable)).length, 0, "receipt does not create AI jobs");
    await dispatchNextMessage();
    await Promise.all([processNextJob(), processNextJob()]);
    assert.ok(globalThis.lastExtractionRequest.messages[1].content.includes("My project is the garden."));
    assert.equal(JSON.parse(globalThis.lastExtractionRequest.messages.at(-1).content).messageContext.receivedAt, "2026-11-15T16:58:00.000Z");
    await api("/prompts", "PUT", "owner", initialPrompts.defaults);
    let data = await (await api("/organizer")).json();
    assert.equal(data.messageCount, 1);
    const job = data.jobs.find(j => j.eventId === receipt.id);
    assert.equal(job.status, "completed", JSON.stringify(job));
    const items = data.items.filter(i => i.sourceEventId === receipt.id);
    assert.equal(items.length, 5);
    assert.equal(new Set(items.map(i => i.id)).size, 5);
    assert.ok(items.every(i => i.id !== receipt.id));
    assert.equal(items[0].kind, "task");
    assert.ok(items.some(i => i.dueAt === "2026-11-15T17:28:00.000Z"));
    assert.equal((await db.select().from(eventsTable)).length, 1);
    await api("/events/" + receipt.id + "/understand", "POST");
    await processNextJob();
    assert.equal((await db.select().from(itemsTable)).length, 0);
    assert.equal((await (await api("/organizer")).json()).items.length, 5);
    const target = items[0];
    assert.equal((await api("/items/" + target.id, "PATCH", "other", { title: "Wrong owner" })).status, 404);
    assert.equal((await api("/items/" + target.id, "DELETE", "other")).status, 404);
    assert.equal((await (await api("/organizer", "GET", "other")).json()).items.length, 0);
    assert.equal((await (await api("/organizer", "GET", "other")).json()).messageCount, 0);
    assert.equal((await notifiedMutation("/items/" + target.id, "PATCH", { title: "Changed", status: "completed" })).status, 200);
    assert.equal((await (await api("/organizer")).json()).items.find(i => i.id === target.id).status, "completed");
    assert.equal((await (await api("/events?view=notes")).json()).items.length,0);
    assert.equal((await api("/items/" + target.id, "PATCH", "owner", { status: "open" })).status, 200);
    assert.equal((await api("/items/" + target.id, "PATCH", "owner", { dueAt: null })).status, 200);
    const unscheduled = (await (await api("/organizer")).json()).items.find(i => i.id === target.id);
    assert.equal(unscheduled.dueAt, null);
    assert.equal(unscheduled.needsReview, false);
    assert.equal(unscheduled.id, target.id);
    assert.equal((await notifiedMutation("/items/" + target.id, "DELETE")).status, 204);
    assert.equal((await (await api("/organizer")).json()).items.some(i => i.id === target.id), false);
    console.log("PASS: completion and deletion notify a separate connection; subsequent dashboard reads reflect both");
    assert.equal((await db.select().from(eventsTable)).length, 1);
    assert.equal((await (await api("/events?view=notes")).json()).items.length, 0);
    const siblings = (await (await api("/organizer")).json()).items;
    assert.deepEqual(siblings, items.filter(i => i.id !== target.id));
    for (const sibling of siblings) await api("/items/" + sibling.id, "DELETE");
    assert.equal((await (await api("/events?view=notes")).json()).items[0].id, receipt.id);
    // Even a forced retry cannot resurrect removed children.
    await db.update(jobsTable).set({status:"pending",attempts:0,availableAt:new Date()}).where(eq(jobsTable.eventId,receipt.id));
    await processNextJob();
    assert.equal((await (await api("/organizer")).json()).items.length, 0);
    assert.equal((await api("/items", "POST", "owner", { kind: "reminder", title: "Manual", dueAt: "2026-11-20T09:00:00Z" })).status, 201);
    assert.equal((await api("/items", "POST", "owner", { kind: "reminder", title: "Bad", dueAt: "2026-11-20T09:00" })).status, 400);
    const ambiguous = { kind: "reminder", title: "DST", localDueAt: "2027-03-14T02:30", minutesFromRecording: null, originalTimeText: "2:30", needsReview: false };
    assert.equal(resolveDue(ambiguous, new Date(), "America/Los_Angeles").needsReview, true);
    // All messages are notes by default; tasks are a filtered view of them.
    const [original] = await db.select().from(eventsTable).where(eq(eventsTable.id, receipt.id));
    const noteFixtures = Array.from({length: 54}, (_, index) => ({
      ...original, id: "plain-note-" + index,
      transcription: index === 53 ? "   " : "A thought to keep.",
      receivedAt: new Date(Date.parse("2026-11-01T12:00:00Z") + index * 1000),
    }));
    await db.insert(eventsTable).values(noteFixtures);
    await db.insert(jobsTable).values(noteFixtures.map((event, index) => ({
      eventId: event.id, ownerId: "owner",
      status: index === 0 ? "pending" : index === 1 ? "failed" : "completed",
    })));
    const notesPage = await (await api("/events?view=notes")).json();
    assert.equal(notesPage.items.length, 50);
    assert.ok(notesPage.nextCursor);
    assert.ok(notesPage.items.every(event => event.id.startsWith("plain-note-") || event.id === receipt.id));
    const olderNotes = await (await api("/events?view=notes&before=" + encodeURIComponent(notesPage.nextCursor))).json();
    assert.equal(olderNotes.items.length, 5);
    assert.equal(olderNotes.nextCursor, null);
    assert.equal(new Set([...notesPage.items, ...olderNotes.items].map(e => e.id)).size, 55);
    assert.equal((await (await api("/events?view=notes", "GET", "other")).json()).items.length, 0);
    assert.equal((await api("/events?view=invalid")).status, 400);
    console.log("PASS: notes classification, original-event retention, pagination and account isolation");
    ambiguous.localDueAt = "2026-11-01T01:30";
    assert.equal(resolveDue(ambiguous, new Date(), "America/Los_Angeles").needsReview, true);
    const input = { recordedAt: new Date("2026-11-15T16:58:00Z"), timezone: "America/Los_Angeles", provider: "replit", model: "gpt-5-mini" };
    const sharedInstruction = "Prepare lower thirds for Tuesday's live stream, Wednesday's office hours, and Friday's showcase; make these separate tasks.";
    const showTasks = [
      ["Prepare lower thirds for Tuesday live stream", "2026-11-17T08:58", "Tuesday"],
      ["Prepare lower thirds for Wednesday office hours", "2026-11-18T08:58", "Wednesday"],
      ["Prepare lower thirds for Friday showcase", "2026-11-20T08:58", "Friday"],
    ];
    globalThis.aiItems = showTasks.map(([title, localDueAt, originalTimeText]) => ({
      title, sourceAction: sharedInstruction, localDueAt, originalTimeText,
      minutesFromRecording: null, needsReview: false,
    }));
    const separateShows = await extractActions({ ...input, transcript: sharedInstruction });
    assert.equal(separateShows.length, 3);
    assert.deepEqual(separateShows.map(task => task.title), showTasks.map(([title]) => title));
    assert.deepEqual(separateShows.map(task => task.dueAt.toISOString()), [
      "2026-11-17T16:58:00.000Z", "2026-11-18T16:58:00.000Z", "2026-11-20T16:58:00.000Z",
    ]);
    const manyInstructions = Array.from({ length: 30 }, (_, i) => "Buy supply " + i + ".");
    globalThis.aiItems = manyInstructions.map(title => ({
      title, sourceAction: title, localDueAt: null, originalTimeText: null,
      minutesFromRecording: null, needsReview: false,
    }));
    assert.equal((await extractActions({ ...input, transcript: manyInstructions.join(" ") })).length, 30);
    delete globalThis.aiItems;
    console.log("PASS: shared-context tasks keep independent deadlines; extraction has no per-message item cap");
    assert.deepEqual(await extractActions({ ...input, transcript: "Index webhook test event" }), []);
    assert.deepEqual(await extractActions({ ...input, transcript: "I like warm colors. Maybe someday a new dashboard could be interesting. It is Tuesday at nine." }), []);
    const dated = await extractActions({ ...input, transcript: "Remind me tomorrow to call Sam." });
    assert.equal(dated.length, 1);
    assert.equal(dated[0].dueAt.toISOString(), "2026-11-16T16:58:00.000Z");
    const noDate = await extractActions({ ...input, transcript: "I need to buy printer paper." });
    assert.equal(noDate.length, 1);
    assert.equal(noDate[0].dueAt, null);
    const evidence = {title:"Buy paper",sourceAction:"Buy paper.",localDueAt:"2026-11-20T09:00",minutesFromRecording:null,originalTimeText:"tomorrow",needsReview:false};
    globalThis.aiItems = [evidence,evidence,{...evidence,title:"Invented",sourceAction:"Not in transcript"}];
    const validated = await extractActions({...input,transcript:"Buy paper."});
    assert.equal(validated.length,1);
    assert.equal(validated[0].dueAt,null);
    globalThis.aiItems = null;
    const fixture = async id => {
      await db.insert(eventsTable).values({id,ownerId:"owner",kind:"json",payload:{},receivedAt:new Date("2026-11-15T16:58:00Z"),transcription:"I need to buy printer paper."});
      await db.insert(jobsTable).values({eventId:id,ownerId:"owner",availableAt:new Date(0)});
    };
    await fixture("four-actions");
    const fourQuotes = ["Buy paper.","Call Sam in 30 minutes.","Send Pat the report.","Water plants tomorrow."];
    await db.update(eventsTable).set({transcription:fourQuotes.join(" ")}).where(eq(eventsTable.id,"four-actions"));
    globalThis.aiItems = fourQuotes.map((quote,i)=>({
      ...evidence,title:["Buy paper","Call Sam","Send report","Water plants"][i],sourceAction:quote,
      minutesFromRecording:i===1?30:null,
      localDueAt:i===3?"2026-11-16T09:00":null,originalTimeText:i===1?"in 30 minutes":i===3?"tomorrow":null,
    }));
    await processNextJob();
    const four = await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,"four-actions"));
    assert.equal(four.length,4);
    assert.equal(new Set(four.map(i=>i.id)).size,4);
    assert.equal(four.filter(i=>i.dueAt).length,2);
    globalThis.aiItems = null;
    for (const mode of ["expired","replaced","manual"]) {
      const id = "race-" + mode;
      await fixture(id);
      let release, entered;
      const started = new Promise(r=>entered=r);
      globalThis.aiGate = () => { entered(); return new Promise(r=>release=r); };
      const work = processNextJob();
      await started;
      if (mode === "expired") await db.update(jobsTable).set({availableAt:new Date(0)}).where(eq(jobsTable.eventId,id));
      if (mode === "replaced") await db.update(jobsTable).set({leaseId:"replacement",status:"completed"}).where(eq(jobsTable.eventId,id));
      if (mode === "manual") {
        await db.update(eventsTable).set({actionsInitializedAt:new Date()}).where(eq(eventsTable.id,id));
        await db.insert(actionsTable).values({id:"manual-race",ownerId:"owner",sourceEventId:id,title:"Keep manual title",timezone:"UTC",editedAt:new Date(),removedAt:new Date()});
      }
      release(); await work; globalThis.aiGate = null;
      const children = await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,id));
      assert.equal(children.length,mode === "manual" ? 1 : 0);
      if (mode === "manual") { assert.equal(children[0].title,"Keep manual title"); assert.ok(children[0].removedAt); }
      await db.update(jobsTable).set({status:"completed"}).where(eq(jobsTable.eventId,id));
    }
    await fixture("rollback");
    await db.execute(sql\`CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source_event_id='rollback' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$\`);
    await db.execute(sql\`CREATE TRIGGER reject_fixture BEFORE INSERT ON active_actions FOR EACH ROW EXECUTE FUNCTION reject_fixture()\`);
    await processNextJob();
    assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,"rollback"))).length,0);
    assert.equal((await db.select().from(eventsTable).where(eq(eventsTable.id,"rollback")))[0].actionsInitializedAt,null);
    assert.notEqual((await db.select().from(jobsTable).where(eq(jobsTable.eventId,"rollback")))[0].status,"completed");
    await db.execute(sql\`DROP TRIGGER reject_fixture ON active_actions\`);
    await db.update(jobsTable).set({status:"pending",availableAt:new Date(0)}).where(eq(jobsTable.eventId,"rollback"));
    await processNextJob();
    assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,"rollback"))).length,1);
    console.log("PASS: evidence, duplicates, expired/replaced leases, manual tombstones and transactional rollback");

    // Every scope covers zero/one/many children regardless of status or pinning.
    for (const scope of ["note", "tasks", "all"]) for (const count of [0, 1, 4]) {
      const id = "scope-" + scope + count;
      await fixture(id);
      const beforeRemoved = new Date("2020-01-01");
      await db.insert(actionsTable).values([
        {id:id+"-old",ownerId:"owner",sourceEventId:id,title:"Already removed",timezone:"UTC",removedAt:beforeRemoved},
        ...Array.from({length:count},(_,i)=>({id:id+i,ownerId:"owner",sourceEventId:id,title:"Task",timezone:"UTC",status:["open","completed","dismissed","open"][i],pinnedAt:i===3?new Date():null})),
      ]);
      assert.equal((await api("/events/"+id+"/deletion","POST","other",{scope})).status,404);
      assert.equal((await api("/events/"+id+"/deletion","POST","",{scope})).status,401);
      assert.equal((await api("/events/"+id+"/deletion","POST","owner",{scope:"account"})).status,400);
      const unrelatedBefore = await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,"four-actions"));
      assert.equal((await notifiedMutation("/events/"+id+"/deletion","POST",{scope})).status,204);
      const source = (await db.select().from(eventsTable).where(eq(eventsTable.id,id)))[0];
      const children = await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,id));
      assert.equal(!!source.deletedAt,scope!=="tasks");
      assert.equal(source.transcription,"I need to buy printer paper.");
      assert.equal(children.filter(t=>!t.removedAt).length,scope==="note"?count:0);
      assert.equal(children.find(t=>t.id===id+"-old").removedAt.toISOString(),beforeRemoved.toISOString());
      assert.deepEqual(await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,"four-actions")),unrelatedBefore);
      const org = await (await api("/organizer")).json();
      assert.ok(org.items.filter(t=>t.sourceEventId===id).every(t=>t.sourceDeleted));
      if(scope==="tasks") {
        assert.ok((await (await api("/events?view=notes")).json()).items.some(e=>e.id===id));
        assert.ok(source.actionsInitializedAt);
      }
      assert.equal((await api("/events/"+id+"/deletion","POST","owner",{scope})).status,204);
    }
    // Deletion while a provider call is running must revoke its lease and
    // permanently fence insertion, even when there were initially no children.
    for (const scope of ["tasks","all"]) {
      const id = "scope-race-"+scope;
      await fixture(id);
      let release, entered;
      const started = new Promise(r=>entered=r);
      globalThis.aiGate = () => { entered(); return new Promise(r=>release=r); };
      const work = processNextJob(); await started;
      assert.equal((await api("/events/"+id+"/deletion","POST","owner",{scope})).status,204);
      release(); await work; globalThis.aiGate=null;
      assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,id))).length,0);
      await db.update(jobsTable).set({status:"pending",availableAt:new Date(0)}).where(eq(jobsTable.eventId,id));
      await processNextJob();
      assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,id))).length,0);
    }
    await fixture("scope-rollback");
    await db.insert(actionsTable).values({id:"scope-rollback-task",ownerId:"owner",sourceEventId:"scope-rollback",title:"Keep",timezone:"UTC"});
    await db.execute(sql\`CREATE FUNCTION reject_scope() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source_event_id='scope-rollback' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$\`);
    await db.execute(sql\`CREATE TRIGGER reject_scope BEFORE UPDATE ON active_actions FOR EACH ROW EXECUTE FUNCTION reject_scope()\`);
    assert.equal((await api("/events/scope-rollback/deletion","POST","owner",{scope:"all"})).status,500);
    assert.equal((await db.select().from(eventsTable).where(eq(eventsTable.id,"scope-rollback")))[0].deletedAt,null);
    assert.equal((await db.select().from(jobsTable).where(eq(jobsTable.eventId,"scope-rollback")))[0].status,"pending");
    assert.equal((await db.select().from(actionsTable).where(eq(actionsTable.id,"scope-rollback-task")))[0].removedAt,null);
    await db.execute(sql\`DROP TRIGGER reject_scope ON active_actions\`);
    console.log("PASS: scoped deletion zero/one/many, all statuses, ownership, notifications, extraction fences and atomic rollback");

    // Migration preserves originals and dates, archives old rows, and is idempotent.
    await db.insert(eventsTable).values({ ...original, id: "legacy-message", audioPath:"fixture-original-audio",audioSize:123, actionsInitializedAt: null, isActionable:true, actionTitle:"Current edited combined summary", dueAt:new Date("2026-11-20T18:00:00Z"),status:"completed",editedAt:new Date() });
    await db.insert(eventsTable).values({ ...original, id: "legacy-test", transcription: "Index webhook test event", actionsInitializedAt:null, unifiedAt: null });
    await db.insert(itemsTable).values([
      {id:"legacy-a",ownerId:"owner",sourceEventId:"legacy-message",kind:"task",title:"First action",timezone:"America/Los_Angeles",status:"completed"},
      {id:"legacy-b",ownerId:"owner",sourceEventId:"legacy-message",kind:"reminder",title:"Second action",timezone:"America/Los_Angeles",dueAt:new Date("2026-11-20T18:00:00Z")},
      {id:"legacy-test-action",ownerId:"owner",sourceEventId:"legacy-test",kind:"task",title:"Index webhook test event",timezone:"UTC"},
      {id:"legacy-manual",ownerId:"owner",sourceEventId:null,kind:"reminder",title:"Manual item",timezone:"UTC",dueAt:new Date("2026-11-21T18:00:00Z")},
    ]);
    await migrateUnifiedItems();
    const once = await db.select().from(eventsTable).where(eq(eventsTable.id,"legacy-message"));
    assert.equal(once[0].isActionable,true);
    assert.equal(once[0].actionTitle,"Current edited combined summary");
    assert.equal(once[0].dueAt.toISOString(),"2026-11-20T18:00:00.000Z");
    assert.equal(once[0].status,"completed");
    assert.equal(once[0].audioPath,"fixture-original-audio");
    assert.equal(once[0].audioSize,123);
    assert.equal(once[0].transcription,original.transcription);
    assert.equal((await db.select().from(eventsTable).where(eq(eventsTable.id,"legacy-test")))[0].isActionable,false);
    assert.equal((await db.select().from(eventsTable).where(eq(eventsTable.id,"legacy-manual"))).length,0);
    const migrated = (await db.select().from(actionsTable).where(eq(actionsTable.sourceEventId,"legacy-message")));
    assert.equal(migrated.length,1);
    assert.equal(migrated[0].title,"Current edited combined summary");
    assert.equal(migrated[0].status,"completed");
    await api("/items/" + migrated[0].id,"DELETE");
    await migrateUnifiedItems();
    assert.deepEqual(await db.select().from(eventsTable).where(eq(eventsTable.id,"legacy-message")),once);
    assert.equal((await db.select().from(itemsTable)).length,4);
    const archive = await db.select().from(itemsTable);
    await api("/events/legacy-message/deletion","POST","owner",{scope:"all"});
    assert.deepEqual(await db.select().from(itemsTable),archive);
    assert.equal((await (await api("/organizer")).json()).items.filter(i=>i.sourceEventId==="legacy-message").length,0);
    console.log("PASS: multiple independent children, safe idempotent migration without archive resurrection");
    await api("/settings", "PATCH", "owner", { allowSignups: false });
    assert.equal((await api("/organizer", "GET", "other")).status, 403);
    console.log("PASS: atomic first owner, access toggle, per-user timezone and owner-only settings");
    console.log("PASS: mocked AI extracts independent tasks with optional due dates");
    console.log("PASS: concurrent workers and repeated processing do not duplicate items or notes");
    console.log("PASS: cross-account isolation, CRUD/undo, original note retention, DST validation");
    // The worker listens through a separate connection and sees only committed work.
    await db.delete(jobsTable);
    await db.insert(eventsTable).values({
      id: "notification-worker-fixture", ownerId: "owner", kind: "json",
      transcription: "Index webhook test event", payload: {},
    });
    const stopWorker = startUnderstandingWorker();
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const started = Date.now();
      await db.transaction(async tx => {
        await tx.insert(jobsTable).values({ eventId: "notification-worker-fixture", ownerId: "owner" });
        await tx.execute(sql\`SELECT pg_notify('ring_inbox_changed', 'owner')\`);
      });
      let completed = false;
      while (Date.now() - started < 4000) {
        const [row] = await db.select().from(jobsTable).where(eq(jobsTable.eventId, "notification-worker-fixture"));
        if (row?.status === "completed") { completed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(completed, "Committed jobs must wake the worker without a five-second polling delay");
      console.log("PASS: real PostgreSQL notification wakes the AI worker and completes queued work");
    } finally { stopWorker(); }
    // Receipt and dispatch are independent, durable and source/owner scoped.
    await db.delete(jobsTable);
    await db.delete(messageOutboxTable);
    await api("/settings", "PATCH", "owner", {allowSignups:true});
    const messageInput = { text: "Call Sam tomorrow", sourceType: "assistant", sourceConnection: "device-one", externalId: "delivery-one",
      occurredAt: "2026-11-15T16:58:00Z", metadata: { authorization: "never-store-me", label: "fixture" } };
    assert.equal((await api("/messages", "POST", "", messageInput)).status, 401);
    const deliveries = await Promise.all(Array.from({length: 4}, () => api("/messages", "POST", "owner", messageInput)));
    assert.ok(deliveries.every(response => response.status === 201));
    const delivered = await Promise.all(deliveries.map(response => response.json()));
    assert.equal(new Set(delivered.map(row => row.id)).size, 1);
    const sourceId = delivered[0].id;
    assert.equal((await db.select().from(jobsTable)).length, 0);
    assert.equal((await db.select().from(messageOutboxTable)).length, 1);
    const sourceView = await (await api("/events/" + sourceId)).json();
    assert.equal(sourceView.text, messageInput.text);
    assert.equal(sourceView.source.type, "assistant");
    assert.equal(sourceView.source.externalId, "delivery-one");
    assert.equal(sourceView.payload.authorization, "[redacted]");
    assert.deepEqual(sourceView.attachments, []);
    assert.equal((await api("/events/" + sourceId, "GET", "other")).status, 404);
    assert.equal((await api("/messages", "POST", "owner", {...messageInput, text: "Different content"})).status, 409);
    // Fail AI queue writes only: ingest stays successful and dispatch retries persist.
    await pool.query("ALTER TABLE understanding_jobs ADD CONSTRAINT reject_dispatch_fixture CHECK (event_id <> '" + sourceId + "')");
    await dispatchNextMessage();
    let handoff = (await db.select().from(messageOutboxTable))[0];
    assert.equal(handoff.dispatchedAt, null);
    assert.equal(handoff.attempts, 1);
    assert.ok(handoff.error);
    assert.equal((await api("/events/" + sourceId)).status, 200);
    assert.equal((await (await api("/organizer")).json()).jobs.find(j => j.eventId === sourceId).status, "pending");
    await pool.query("ALTER TABLE understanding_jobs DROP CONSTRAINT reject_dispatch_fixture");
    await db.update(messageOutboxTable).set({availableAt:new Date(0)});
    await Promise.all([dispatchNextMessage(), dispatchNextMessage()]);
    assert.equal((await db.select().from(jobsTable)).length, 1);
    assert.ok((await db.select().from(messageOutboxTable))[0].dispatchedAt);
    await processNextJob();
    assert.equal((await db.select().from(jobsTable))[0].processor, "task-extraction");
    assert.ok((await db.select().from(jobsTable))[0].model);
    // A retried delivery after deleting the original must never resurrect it.
    assert.equal((await api("/events/" + sourceId + "/deletion", "POST", "owner", {scope:"note"})).status, 204);
    assert.equal((await (await api("/messages", "POST", "owner", messageInput)).json()).id, sourceId);
    assert.ok((await (await api("/events/" + sourceId)).json()).deletedAt);
    const other = await (await api("/messages", "POST", "other", messageInput)).json();
    assert.notEqual(other.id, sourceId);
    const secondConnection = await (await api("/messages", "POST", "owner", {...messageInput, sourceConnection:"device-two"})).json();
    assert.notEqual(secondConnection.id, sourceId);
    const noId = {...messageInput}; delete noId.externalId;
    const repeatA = await (await api("/messages", "POST", "owner", noId)).json();
    const repeatB = await (await api("/messages", "POST", "owner", noId)).json();
    assert.notEqual(repeatA.id, repeatB.id, "equal text alone is never deduplicated");
    const webhookHeaders = {"content-type":"application/json", authorization:hook.headerValue, "Idempotency-Key":"stable-fixture"};
    const sendHook = body => fetch(base + hook.webhook.path.slice(4), {method:"POST", headers:webhookHeaders, body:JSON.stringify(body)});
    const h1 = await (await sendHook({transcription:"A new thought"})).json();
    const h2 = await (await sendHook({transcription:"A new thought"})).json();
    assert.equal(h1.id, h2.id);
    assert.equal((await sendHook({transcription:"A different thought"})).status, 409);
    const h3 = await sendHook({transcription:"A new thought"});
    assert.equal(h3.status, 201, "conflict did not poison later retries");
    console.log("PASS: normalized messages, concurrent deduplication, safe conflict handling, owner/source isolation and durable dispatch failure recovery");
    // Exercise real private storage with a small ISO-BMFF header fixture, not a
    // playback-quality recording. Round-trip bytes and clean up every upload.
    const audioBytes = Buffer.from("00000018667479704d344120000000004d3441206d703432", "hex");
    const recording = async time => {
      const form = new FormData();
      form.append("audio", new Blob([audioBytes], {type:"audio/mp4"}), "fixture.m4a");
      form.append("recordedAt", String(time));
      return fetch(base + hook.webhook.path.slice(4), {method:"POST",headers:{authorization:hook.headerValue},body:form});
    };
    const audioOneResponse = await recording(1790000000000);
    assert.equal(audioOneResponse.status, 201);
    const audioOne = await audioOneResponse.json();
    const audioTwo = await (await recording(1790000000000)).json();
    assert.equal(audioOne.id, audioTwo.id);
    const laterRecording = await (await recording(1790000001000)).json();
    assert.notEqual(laterRecording.id, audioOne.id, "different recording time preserves a legitimate new recording");
    const recordingView = await (await api("/events/" + audioOne.id)).json();
    assert.equal(recordingView.source.type, "pebble");
    assert.equal(recordingView.attachments[0].url, recordingView.audioUrl);
    const readback = await api("/events/" + audioOne.id + "/audio");
    assert.equal(readback.status, 200);
    assert.deepEqual(Buffer.from(await readback.arrayBuffer()), audioBytes);
    console.log("PASS: multipart private audio upload/readback and timestamp-plus-audio deduplication");
    // Start after receipt to prove restart catch-up, then send another live event.
    const stopDispatch = startMessageDispatcher();
    const stopUnderstanding = startUnderstandingWorker();
    try {
      const live = await (await api("/messages", "POST", "owner", {...messageInput, externalId:"live-wakeup", text:"Index webhook test event"})).json();
      const deadline = Date.now() + 4000;
      let complete = false;
      while (Date.now() < deadline) {
        const rows = await db.select().from(jobsTable).where(eq(jobsTable.eventId, live.id));
        if (rows[0]?.status === "completed") { complete = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(complete, "receipt, dispatch and extraction complete without polling delay");
      assert.ok((await db.select().from(messageOutboxTable)).every(row => row.dispatchedAt));
      console.log("PASS: startup backlog plus live receipt dispatch and processing through PostgreSQL notifications");
    } finally { stopDispatch(); stopUnderstanding(); await new Promise(resolve => setTimeout(resolve, 100)); }
  } finally {
    for (const event of await db.select().from(eventsTable)) {
      if (event.audioPath) await audioFile(event.audioPath).delete().catch(() => {});
    }
    await listener.query("UNLISTEN ring_inbox_changed");
    listener.release();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}
`,
      resolveDir: resolve("artifacts/api-server"), loader: "ts",
    },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent", external: ["pg-native"],
    plugins: [{
      name: "isolated-db-and-identity",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
        builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "auth", namespace: "fixture" }));
        builder.onResolve({ filter: /^@workspace\/integrations-openai-ai-server$/ }, () => ({ path: "ai", namespace: "fixture" }));
        builder.onLoad({ filter: /^ai$/, namespace: "fixture" }, () => ({
          contents: `
          const create = async request => {
            if (request.response_format.json_schema.schema.properties.items.maxItems !== undefined) throw new Error("Task count must not be capped");
            const prompt = request.messages[0].content;
            if (/exactly ONE annotation|summarize them together/i.test(prompt)) throw new Error("Single-task instruction regression");
            if (globalThis.aiGate) await globalThis.aiGate();
            if (globalThis.aiError) throw globalThis.aiError;
            globalThis.lastExtractionRequest = request;
            const text = JSON.parse(request.messages.at(-1).content).transcript;
            const item = (title,sourceAction,minutes=null,local=null,time=null) => ({title,sourceAction,minutesFromRecording:minutes,localDueAt:local,originalTimeText:time,needsReview:false});
            const items = globalThis.aiItems ?? (text.startsWith("Add update") ? [
              item("Update landing page","Add update the landing page to my task list."),
              item("Buy paper","Also add buy printer paper to my task list."),
              item("Call Sam","Remind me in 30 minutes to call Sam.",30,null,"in 30 minutes"),
              item("Send report","Remind me tomorrow at 9 AM to send the report.",null,"2026-11-16T09:00","tomorrow at 9 AM"),
              item("Check plants","Remind me tomorrow to check the plants.",null,"2026-11-16T08:58","tomorrow"),
            ] : text === "Remind me tomorrow to call Sam." ? [item("Call Sam",text,null,"2026-11-16T08:58","tomorrow")]
              : text === "I need to buy printer paper." ? [item("Buy paper",text)] : []);
            return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({items})}}]};
          };
          export const openai = {withOptions:()=>({chat:{completions:{create}}})};
          `,
        }));
        builder.onLoad({ filter: /auth/, namespace: "fixture" }, () => ({ contents: 'export const getAuth = req => ({ userId: req.headers["x-test-owner"] || null });' }));
        builder.onLoad({ filter: /db/, namespace: "fixture" }, () => ({
          resolveDir: resolve("lib/db"),
          contents: `import pg from "pg"; import {drizzle} from "drizzle-orm/node-postgres"; import * as schema from "./src/schema"; export * from "./src/schema"; export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, options:"-c search_path=${schemaName}"}); export const db=drizzle(pool,{schema});`,
        }));
      },
    }],
  });
  await createRequire(import.meta.url)(outfile).check();
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await rm(temp, { recursive: true, force: true });
}
