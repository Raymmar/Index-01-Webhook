import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { db, appSettingsTable, preferencesTable, jobsTable, eventsTable, actionsTable, messageOutboxTable } from "@workspace/db";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { UpdateSettingsBody, CreateItemBody, UpdateItemBody, UpdateItemParams, DeleteItemParams, RestoreItemParams, UnderstandEventParams, PinItemParams } from "@workspace/api-zod";
import { accountFor, validTimezone, parseInstant } from "../lib/account";
import { managedModels, directModels } from "../lib/ai-models";
import { publicAction } from "../lib/unified-items";
import { ingestMessage, DeliveryConflict } from "../lib/message-ingestion";
import { CreateMessageBody } from "@workspace/api-zod";
import { UpdatePromptsBody, GetPromptsResponse } from "@workspace/api-zod";
import { defaultInstructions, resolveInstructions, renderSkill } from "../lib/extraction-skill";

const router: IRouter = Router();
router.use(async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Please sign in" }); return; }
  res.locals.ownerId = userId;
  res.locals.account = await accountFor(userId);
  res.set("Cache-Control", "private, no-store");
  next();
});
function settings(account: Awaited<ReturnType<typeof accountFor>>) {
  return {
    isOwner: account.isOwner, allowed: account.allowed, timezone: account.timezone,
    skipTaskDismissConfirmation: account.skipTaskDismissConfirmation,
    skipTaskDeleteConfirmation: account.skipTaskDeleteConfirmation,
    skipMessageDeleteConfirmation: account.skipMessageDeleteConfirmation,
    allowSignups: account.app.allowSignups, aiProvider: account.app.aiProvider, aiModel: account.app.aiModel,
    directKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    managedConfigured: Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL),
    availableModels: account.app.aiProvider === "replit" ? managedModels : directModels,
  };
}
router.get("/settings", (_req, res) => { res.json(settings(res.locals.account)); });
router.use((_req, res, next) => {
  if (!res.locals.account.allowed) { res.status(403).json({ error: "This workspace is private" }); return; }
  next();
});
router.patch("/settings", async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid settings" }); return; }
  const data = body.data;
  if (data.timezone && !validTimezone(data.timezone)) { res.status(400).json({ error: "Choose a valid timezone" }); return; }
  const adminChange = data.allowSignups !== undefined || data.aiProvider !== undefined || data.aiModel !== undefined;
  if (adminChange && !res.locals.account.isOwner) { res.status(403).json({ error: "Only the owner can change app settings" }); return; }
  if (data.aiProvider === "openai" && !process.env.OPENAI_API_KEY) { res.status(400).json({ error: "Set OPENAI_API_KEY in server secrets first" }); return; }
  if (data.aiModel !== undefined && !data.aiModel.trim()) { res.status(400).json({ error: "Model is required" }); return; }
  if ((data.aiModel !== undefined || data.aiProvider !== undefined) &&
      (data.aiProvider ?? res.locals.account.app.aiProvider) === "replit" &&
      !managedModels.includes((data.aiModel ?? res.locals.account.app.aiModel).trim())) {
    res.status(400).json({ error: "Choose a supported Replit model from the selector." }); return;
  }
  await db.transaction(async (tx) => {
    const personal = {
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.skipTaskDismissConfirmation !== undefined ? { skipTaskDismissConfirmation: data.skipTaskDismissConfirmation } : {}),
      ...(data.skipTaskDeleteConfirmation !== undefined ? { skipTaskDeleteConfirmation: data.skipTaskDeleteConfirmation } : {}),
      ...(data.skipMessageDeleteConfirmation !== undefined ? { skipMessageDeleteConfirmation: data.skipMessageDeleteConfirmation } : {}),
    };
    if (Object.keys(personal).length) await tx.update(preferencesTable).set(personal).where(eq(preferencesTable.ownerId, res.locals.ownerId));
    if (adminChange) await tx.update(appSettingsTable).set({
      ...(data.allowSignups !== undefined ? { allowSignups: data.allowSignups } : {}),
      ...(data.aiProvider ? { aiProvider: data.aiProvider } : {}),
      ...(data.aiModel ? { aiModel: data.aiModel.trim() } : {}),
    }).where(eq(appSettingsTable.id, 1));
    // Notify all connected accounts when their access or shared provider changes.
    if (adminChange) await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', owner_id) FROM user_preferences`);
    else await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  });
  res.json(settings(await accountFor(res.locals.ownerId)));
});
router.get("/organizer", async (_req, res) => {
  const items = await db.select({ action: actionsTable, deletedAt: eventsTable.deletedAt }).from(actionsTable).innerJoin(eventsTable, eq(actionsTable.sourceEventId, eventsTable.id)).where(and(eq(actionsTable.ownerId, res.locals.ownerId), isNull(actionsTable.removedAt))).orderBy(desc(actionsTable.createdAt), desc(actionsTable.id));
  const jobs = await db.select({ eventId: jobsTable.eventId, status: jobsTable.status, error: jobsTable.error, processor: jobsTable.processor, processorVersion: jobsTable.processorVersion, provider: jobsTable.provider, model: jobsTable.model }).from(jobsTable).where(eq(jobsTable.ownerId, res.locals.ownerId));
  const pending = await db.select({ eventId: messageOutboxTable.eventId, error: messageOutboxTable.error })
    .from(messageOutboxTable).innerJoin(eventsTable, eq(eventsTable.id, messageOutboxTable.eventId))
    .where(and(eq(messageOutboxTable.ownerId, res.locals.ownerId), isNull(messageOutboxTable.dispatchedAt),
      isNull(eventsTable.deletedAt), isNull(eventsTable.actionsInitializedAt), sql`length(trim(coalesce(${eventsTable.transcription}, ''))) > 0`));
  const jobIds = new Set(jobs.map(job => job.eventId));
  for (const row of pending) if (!jobIds.has(row.eventId)) jobs.push({
    ...row, status: "pending", processor: "task-extraction", processorVersion: 1, provider: null, model: null,
  });
  const [messages] = await db.select({ total: sql<number>`count(*)::int` }).from(eventsTable).where(and(eq(eventsTable.ownerId, res.locals.ownerId), isNull(eventsTable.deletedAt)));
  res.json({ items: items.map(({ action, deletedAt }) => ({ ...publicAction(action), sourceDeleted: !!deletedAt })), jobs, messageCount: messages.total });
});
router.get("/prompts", async (_req, res): Promise<void> => {
  const [saved] = await db.select().from(preferencesTable).where(eq(preferencesTable.ownerId, res.locals.ownerId));
  const instructions = resolveInstructions(saved);
  res.json(GetPromptsResponse.parse({ instructions, defaults: defaultInstructions, skill: renderSkill(instructions) }));
});
router.put("/prompts", async (req, res): Promise<void> => {
  const parsed = UpdatePromptsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Each prompt field must be text of at most 6,000 characters." }); return; }
  await db.transaction(async tx => {
    await tx.update(preferencesTable).set(parsed.data).where(eq(preferencesTable.ownerId, res.locals.ownerId));
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  });
  res.json(GetPromptsResponse.parse({ instructions: parsed.data, defaults: defaultInstructions, skill: renderSkill(parsed.data) }));
});
router.post("/messages", async (req, res): Promise<void> => {
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.text.trim()) { res.status(400).json({ error: "Invalid message" }); return; }
  const input = parsed.data;
  const occurredAt = input.occurredAt ?? null;
  try {
    const receipt = await db.transaction(tx => ingestMessage(tx, {
      ownerId: res.locals.ownerId, sourceType: input.sourceType,
      sourceConnection: input.sourceConnection, externalId: input.externalId,
      text: input.text, occurredAt, payload: input.metadata ?? {}, kind: "json",
    }));
    res.status(201).json({ id: receipt.id, received: true });
  } catch (error) {
    if (error instanceof DeliveryConflict) { res.status(409).json({ error: error.message }); return; }
    throw error;
  }
});
router.post("/events/:id/understand", async (req, res): Promise<void> => {
  const params = UnderstandEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid note" }); return; }
  const [event] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId)));
  if (!event || event.deletedAt) { res.status(404).json({ error: "Note not found" }); return; }
  if (!event.transcription?.trim()) { res.status(400).json({ error: "This note has no transcript" }); return; }
  if (!res.locals.account.timezone) { res.status(400).json({ error: "Set your timezone first" }); return; }
  await db.transaction(async (tx) => {
    await tx.insert(jobsTable).values({ eventId: event.id, ownerId: event.ownerId }).onConflictDoUpdate({
      target: jobsTable.eventId,
      set: { status: "pending", attempts: 0, availableAt: new Date(), error: null, leaseId: null },
      setWhere: eq(jobsTable.status, "failed"),
    });
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${event.ownerId})`);
  });
  res.status(202).end();
});
router.post("/items", async (req, res): Promise<void> => {
  const body = CreateItemBody.safeParse(req.body);
  if (!body.success || !body.data.title.trim()) { res.status(400).json({ error: "Enter a title" }); return; }
  if (!res.locals.account.timezone) { res.status(400).json({ error: "Set your timezone first" }); return; }
  let dueAt;
  try { dueAt = parseInstant(body.data.dueAt); } catch { res.status(400).json({ error: "Invalid date" }); return; }
  const item = await db.transaction(async tx => {
    const { id: sourceEventId } = await ingestMessage(tx, {
      ownerId: res.locals.ownerId, kind: "json", sourceType: "manual", sourceConnection: "manual",
      text: body.data.title.trim(), occurredAt: null, payload: { source: "manual" }, initialized: true,
    });
    const [created] = await tx.insert(actionsTable).values({
      id: randomUUID(), sourceEventId, ownerId: res.locals.ownerId,
      title: body.data.title.trim(), dueAt, timezone: res.locals.account.timezone,
      editedAt: new Date(),
    }).returning();
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
    return created!;
  });
  res.status(201).json(publicAction(item!));
});
router.post("/items/:id/pin", async (req, res): Promise<void> => {
  const params = PinItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const item = await db.transaction(async tx => {
    // Serialize pins per owner, including simultaneous requests from other devices.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${res.locals.ownerId}, 20))`);
    const [pinned] = await tx.update(actionsTable).set({
      pinnedAt: sql`greatest(clock_timestamp(), (SELECT max(pinned_at) + interval '1 millisecond' FROM active_actions WHERE owner_id = ${res.locals.ownerId}))`,
    }).where(and(eq(actionsTable.id, params.data.id), eq(actionsTable.ownerId, res.locals.ownerId), isNull(actionsTable.removedAt))).returning();
    if (pinned) await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
    return pinned;
  });
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(publicAction(item));
});
router.delete("/items/:id/pin", async (req, res): Promise<void> => {
  const params = PinItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const [item] = await db.update(actionsTable).set({ pinnedAt: null }).where(and(
    eq(actionsTable.id, params.data.id), eq(actionsTable.ownerId, res.locals.ownerId), isNull(actionsTable.removedAt),
  )).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  await db.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  res.json(publicAction(item));
});
router.patch("/items/:id", async (req, res): Promise<void> => {
  const params = UpdateItemParams.safeParse(req.params);
  const body = UpdateItemBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.title !== undefined && !body.data.title.trim())) { res.status(400).json({ error: "Invalid item" }); return; }
  const [current] = await db.select().from(actionsTable).where(and(eq(actionsTable.id, params.data.id), eq(actionsTable.ownerId, res.locals.ownerId), isNull(actionsTable.removedAt)));
  if (!current) { res.status(404).json({ error: "Item not found" }); return; }
  let dueAt = current.dueAt;
  try { if (body.data.dueAt !== undefined) dueAt = parseInstant(body.data.dueAt); }
  catch { res.status(400).json({ error: "Invalid date" }); return; }
  const [item] = await db.update(actionsTable).set({
    ...(body.data.title !== undefined ? { title: body.data.title.trim() } : {}),
    ...(body.data.status ? { status: body.data.status } : {}),
    ...(body.data.dueAt !== undefined ? { dueAt } : {}),
    editedAt: new Date(),
    ...(body.data.dueAt !== undefined ? { needsReview: false } : body.data.needsReview !== undefined ? { needsReview: body.data.needsReview } : {}),
  }).where(and(eq(actionsTable.id, params.data.id), eq(actionsTable.ownerId, res.locals.ownerId), isNull(actionsTable.removedAt))).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  await db.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  res.json(publicAction(item!));
});
router.post("/items/:id/restore", async (req, res): Promise<void> => {
  const params = RestoreItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const result = await db.transaction(async tx => {
    // Lock the exact action so expiry and simultaneous restores are checked atomically.
    const [current] = await tx.select().from(actionsTable).where(and(
      eq(actionsTable.id, params.data.id), eq(actionsTable.ownerId, res.locals.ownerId),
      isNotNull(actionsTable.removedAt),
    )).for("update");
    if (!current) return { status: 404 as const };
    if (Date.now() - current.removedAt!.getTime() >= 15_000) return { status: 410 as const };
    const [item] = await tx.update(actionsTable).set({ removedAt: null, editedAt: new Date() })
      .where(and(eq(actionsTable.id, current.id), eq(actionsTable.ownerId, res.locals.ownerId))).returning();
    const [source] = await tx.select({ deletedAt: eventsTable.deletedAt }).from(eventsTable)
      .where(eq(eventsTable.id, item.sourceEventId));
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
    return { status: 200 as const, item: { ...publicAction(item), sourceDeleted: !!source?.deletedAt } };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.status === 410 ? "Undo period expired" : "Removed task not found" });
    return;
  }
  res.json(result.item);
});
router.delete("/items/:id", async (req, res): Promise<void> => {
  const params = DeleteItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const rows = await db.update(actionsTable).set({
    removedAt: new Date(), editedAt: new Date(),
  }).where(and(eq(actionsTable.id, params.data.id), eq(actionsTable.ownerId, res.locals.ownerId), isNull(actionsTable.removedAt))).returning({ id: actionsTable.id });
  if (!rows.length) { res.status(404).json({ error: "Item not found" }); return; }
  await db.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  res.status(204).end();
});
export default router;
