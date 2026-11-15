import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { db, appSettingsTable, preferencesTable, jobsTable, eventsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { UpdateSettingsBody, CreateItemBody, UpdateItemBody, UpdateItemParams, DeleteItemParams, UnderstandEventParams } from "@workspace/api-zod";
import { accountFor, validTimezone, parseInstant } from "../lib/account";
import { managedModels, directModels } from "../lib/ai-models";
import { publicAction } from "../lib/unified-items";

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
    if (data.timezone) await tx.update(preferencesTable).set({ timezone: data.timezone }).where(eq(preferencesTable.ownerId, res.locals.ownerId));
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
  const items = await db.select().from(eventsTable).where(and(eq(eventsTable.ownerId, res.locals.ownerId), eq(eventsTable.isActionable, true))).orderBy(desc(eventsTable.receivedAt));
  const jobs = await db.select({ eventId: jobsTable.eventId, status: jobsTable.status, error: jobsTable.error }).from(jobsTable).where(eq(jobsTable.ownerId, res.locals.ownerId));
  const [messages] = await db.select({ total: sql<number>`count(*)::int` }).from(eventsTable).where(eq(eventsTable.ownerId, res.locals.ownerId));
  res.json({ items: items.map(publicAction), jobs, messageCount: messages.total });
});
router.post("/events/:id/understand", async (req, res): Promise<void> => {
  const params = UnderstandEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid note" }); return; }
  const [event] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId)));
  if (!event) { res.status(404).json({ error: "Note not found" }); return; }
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
  const [item] = await db.insert(eventsTable).values({
    id: randomUUID(), ownerId: res.locals.ownerId, kind: "json",
    transcription: body.data.title.trim(), payload: { source: "manual" },
    isActionable: true, actionTitle: body.data.title.trim(), dueAt,
    timezone: res.locals.account.timezone, unifiedAt: new Date(), editedAt: new Date(),
  }).returning();
  await db.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  res.status(201).json(publicAction(item!));
});
router.patch("/items/:id", async (req, res): Promise<void> => {
  const params = UpdateItemParams.safeParse(req.params);
  const body = UpdateItemBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.title !== undefined && !body.data.title.trim())) { res.status(400).json({ error: "Invalid item" }); return; }
  const [current] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId), eq(eventsTable.isActionable, true)));
  if (!current) { res.status(404).json({ error: "Item not found" }); return; }
  let dueAt = current.dueAt;
  try { if (body.data.dueAt !== undefined) dueAt = parseInstant(body.data.dueAt); }
  catch { res.status(400).json({ error: "Invalid date" }); return; }
  const [item] = await db.update(eventsTable).set({
    ...(body.data.title !== undefined ? { actionTitle: body.data.title.trim() } : {}),
    ...(body.data.status ? { status: body.data.status } : {}),
    ...(body.data.dueAt !== undefined ? { dueAt } : {}),
    editedAt: new Date(),
    needsReview: body.data.dueAt !== undefined ? false : body.data.needsReview ?? current.needsReview,
  }).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId), eq(eventsTable.isActionable, true))).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  await db.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  res.json(publicAction(item!));
});
router.delete("/items/:id", async (req, res): Promise<void> => {
  const params = DeleteItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const rows = await db.update(eventsTable).set({
    isActionable: false, actionTitle: null, dueAt: null, status: "open",
    needsReview: false, originalTimeText: null, editedAt: new Date(),
  }).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId), eq(eventsTable.isActionable, true))).returning({ id: eventsTable.id });
  if (!rows.length) { res.status(404).json({ error: "Item not found" }); return; }
  await db.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
  res.status(204).end();
});
export default router;
