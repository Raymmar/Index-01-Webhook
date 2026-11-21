import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomBytes, randomUUID } from "node:crypto";
import { db, webhooksTable, eventsTable, actionsTable, jobsTable, type WebhookRow } from "@workspace/db";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { CreateWebhookBody, CreateWebhookResponse, ListWebhooksResponse, ListEventsQueryParams, ListEventsResponse, RotateWebhookParams, RevokeWebhookParams, GetEventAudioParams, GetEventParams, GetEventResponse } from "@workspace/api-zod";
import { hashToken } from "./receive";
import { audioFile } from "../lib/recording-storage";
import { openInboxStream } from "../lib/inbox-stream";
import { DeleteSourceBody, DeleteSourceParams } from "@workspace/api-zod";

const router: IRouter = Router();
const publicHook = (hook: WebhookRow) => ({
  id: hook.id, name: hook.name, path: `/api/receive/${hook.id}`,
  createdAt: hook.createdAt.toISOString(), lastReceivedAt: hook.lastReceivedAt?.toISOString() ?? null,
  eventCount: hook.eventCount,
});

router.use((req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Please sign in" }); return; }
  res.locals.ownerId = userId;
  res.set("Cache-Control", "private, no-store");
  next();
});

router.get("/webhooks", async (_req, res): Promise<void> => {
  const rows = await db.select().from(webhooksTable).where(and(eq(webhooksTable.ownerId, res.locals.ownerId), isNull(webhooksTable.revokedAt))).orderBy(desc(webhooksTable.createdAt));
  res.json(ListWebhooksResponse.parse(rows.map(publicHook)));
});

router.post("/webhooks", async (req, res): Promise<void> => {
  const body = CreateWebhookBody.safeParse(req.body);
  if (!body.success || !body.data.name.trim()) { res.status(400).json({ error: "Enter a webhook name (1–80 characters)" }); return; }
  const token = randomBytes(32).toString("base64url");
  const [hook] = await db.insert(webhooksTable).values({
    id: randomUUID(), name: body.data.name.trim(), ownerId: res.locals.ownerId, tokenHash: hashToken(token),
  }).returning();
  res.status(201).json(CreateWebhookResponse.parse({ webhook: publicHook(hook!), headerName: "Authorization", headerValue: `Bearer ${token}` }));
});

router.post("/webhooks/:id/rotate", async (req, res): Promise<void> => {
  const params = RotateWebhookParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid endpoint" }); return; }
  const token = randomBytes(32).toString("base64url");
  const [hook] = await db.update(webhooksTable).set({ tokenHash: hashToken(token) }).where(and(
    eq(webhooksTable.id, params.data.id), eq(webhooksTable.ownerId, res.locals.ownerId), isNull(webhooksTable.revokedAt),
  )).returning();
  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(CreateWebhookResponse.parse({ webhook: publicHook(hook), headerName: "Authorization", headerValue: `Bearer ${token}` }));
});

router.delete("/webhooks/:id", async (req, res): Promise<void> => {
  const params = RevokeWebhookParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid endpoint" }); return; }
  const revoked = await db.transaction(async (tx) => {
    // Retain the row: inbox events reference it and must remain readable.
    const [hook] = await tx.update(webhooksTable).set({
      revokedAt: sql`coalesce(${webhooksTable.revokedAt}, now())`,
    }).where(and(
      eq(webhooksTable.id, params.data.id), eq(webhooksTable.ownerId, res.locals.ownerId),
    )).returning({ id: webhooksTable.id });
    if (!hook) return false;
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
    return true;
  });
  if (!revoked) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.status(204).end();
});

router.get("/events/stream", async (_req, res): Promise<void> => {
  await openInboxStream(res, res.locals.ownerId);
});

router.get("/events", async (req, res): Promise<void> => {
  const query = ListEventsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid query" }); return; }
  const pageSize = query.data.pageSize ?? 50;
  let older;
  if (query.data.before) {
    const [time, id, extra] = query.data.before.split("|");
    const date = new Date(time!);
    if (!id || extra !== undefined || !Number.isFinite(date.getTime())) { res.status(400).json({ error: "Invalid cursor" }); return; }
    // PostgreSQL defaults have microsecond precision; Date only retains millis.
    // Preserve the remaining digits or manual notes can be skipped at a boundary.
    const micros = time!.match(/\.(\d{1,6})Z$/)?.[1]?.slice(3).padEnd(3, "0") ?? "000";
    const timestamp = date.toISOString().replace(/Z$/, `${micros}Z`);
    older = or(sql`${eventsTable.receivedAt} < ${timestamp}::timestamptz`,
      and(sql`${eventsTable.receivedAt} = ${timestamp}::timestamptz`, lt(eventsTable.id, id)));
  }
  const rows = await db.select({
    event: eventsTable, webhookName: webhooksTable.name,
    cursorTime: sql<string>`to_char(${eventsTable.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(eventsTable)
    .leftJoin(webhooksTable, eq(eventsTable.webhookId, webhooksTable.id))
    .where(and(eq(eventsTable.ownerId, res.locals.ownerId), isNull(eventsTable.deletedAt), older,
      query.data.view === "notes" ? and(
        sql`NOT EXISTS (SELECT 1 FROM ${actionsTable} WHERE ${actionsTable.sourceEventId} = ${eventsTable.id} AND ${actionsTable.ownerId} = ${eventsTable.ownerId} AND ${actionsTable.removedAt} IS NULL)`,
      ) : undefined,
    ))
    .orderBy(desc(eventsTable.receivedAt), desc(eventsTable.id)).limit(pageSize + 1);
  const items = rows.slice(0, pageSize).map(({ event, webhookName }) => ({
    id: event.id, webhookId: event.webhookId, webhookName: webhookName ?? "Manual", receivedAt: event.receivedAt.toISOString(),
    recordedAt: event.recordedAt?.toISOString() ?? null, kind: event.kind,
    transcription: event.transcription, audioSize: event.audioSize,
    audioUrl: event.audioPath ? `/api/events/${event.id}/audio` : null, payload: event.payload,
  }));
  const last = items.at(-1);
  res.json(ListEventsResponse.parse({ items, nextCursor: rows.length > pageSize && last ? `${rows[pageSize - 1]!.cursorTime}|${last.id}` : null }));
});

router.post("/events/:id/deletion", async (req, res): Promise<void> => {
  const params = DeleteSourceParams.safeParse(req.params);
  const body = DeleteSourceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid deletion scope" }); return; }
  const { scope } = body.data;
  const ownerId = res.locals.ownerId;
  const event = await db.transaction(async tx => {
    // Same job -> source -> actions ordering as extraction. The source barrier
    // also fences jobs inserted concurrently when no job existed yet.
    await tx.update(jobsTable).set({ status: "completed", leaseId: null, error: null })
      .where(and(eq(jobsTable.eventId, params.data.id), eq(jobsTable.ownerId, ownerId)));
    const [source] = await tx.update(eventsTable).set({
      ...(scope !== "tasks" ? { deletedAt: sql`coalesce(${eventsTable.deletedAt}, now())` } : {}),
      ...(scope !== "note" ? { actionsInitializedAt: sql`coalesce(${eventsTable.actionsInitializedAt}, now())` } : {}),
    }).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, ownerId))).returning({ id: eventsTable.id });
    if (!source) return null;
    if (scope !== "note") await tx.update(actionsTable).set({ removedAt: new Date(), editedAt: new Date() })
      .where(and(eq(actionsTable.sourceEventId, source.id), eq(actionsTable.ownerId, ownerId), isNull(actionsTable.removedAt)));
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${ownerId})`);
    return source;
  });
  if (!event) { res.status(404).json({ error: "Note not found" }); return; }
  res.status(204).end();
});

router.delete("/events/:id", async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid event" }); return; }
  const event = await db.transaction(async tx => {
    // Match the worker's job-then-source lock order. Revoke an active lease too.
    await tx.update(jobsTable).set({ status: "completed", leaseId: null, error: null })
      .where(and(eq(jobsTable.eventId, params.data.id), eq(jobsTable.ownerId, res.locals.ownerId)));
    const [deleted] = await tx.update(eventsTable).set({ deletedAt: sql`coalesce(${eventsTable.deletedAt}, now())` })
      .where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId))).returning({ id: eventsTable.id });
    if (deleted) await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${res.locals.ownerId})`);
    return deleted;
  });
  if (!event) { res.status(404).json({ error: "Message not found" }); return; }
  res.status(204).end();
});
router.get("/events/:id", async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid event" }); return; }
  const [row] = await db.select({ event: eventsTable, webhookName: webhooksTable.name })
    .from(eventsTable).leftJoin(webhooksTable, eq(eventsTable.webhookId, webhooksTable.id))
    .where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId)));
  if (!row) { res.status(404).json({ error: "Message not found" }); return; }
  const { event, webhookName } = row;
  res.json(GetEventResponse.parse({
    id: event.id, webhookId: event.webhookId, webhookName: webhookName ?? "Manual",
    receivedAt: event.receivedAt.toISOString(), recordedAt: event.recordedAt?.toISOString() ?? null,
    deletedAt: event.deletedAt?.toISOString() ?? null,
    kind: event.kind, transcription: event.deletedAt ? null : event.transcription, audioSize: event.deletedAt ? null : event.audioSize,
    audioUrl: !event.deletedAt && event.audioPath ? `/api/events/${event.id}/audio` : null, payload: event.deletedAt ? {} : event.payload,
  }));
});

router.get("/events/:id/audio", async (req, res): Promise<void> => {
  const params = GetEventAudioParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid event" }); return; }
  const [event] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId)));
  if (!event?.audioPath || !event.audioSize || event.deletedAt) { res.status(404).json({ error: "Audio not found" }); return; }
  const size = event.audioSize;
  const range = req.get("range");
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.status(416).set("Content-Range", `bytes */${size}`).end(); return; }
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
    if (start > end || start >= size) { res.status(416).set("Content-Range", `bytes */${size}`).end(); return; }
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.set({ "Content-Type": "audio/mp4", "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "X-Content-Type-Options": "nosniff" });
  const stream = audioFile(event.audioPath).createReadStream({ start, end });
  stream.on("error", () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
});

export default router;
