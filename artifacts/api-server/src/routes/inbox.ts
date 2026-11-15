import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomBytes, randomUUID } from "node:crypto";
import { db, webhooksTable, eventsTable, jobsTable, itemsTable, type WebhookRow } from "@workspace/db";
import { and, desc, eq, exists, notExists, isNull, lt, or, sql } from "drizzle-orm";
import { CreateWebhookBody, CreateWebhookResponse, ListWebhooksResponse, ListEventsQueryParams, ListEventsResponse, RotateWebhookParams, RevokeWebhookParams, GetEventAudioParams } from "@workspace/api-zod";
import { hashToken } from "./receive";
import { audioFile } from "../lib/recording-storage";
import { openInboxStream } from "../lib/inbox-stream";

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
  let older;
  if (query.data.before) {
    const [time, id] = query.data.before.split("|");
    const date = new Date(time!);
    if (!id || !Number.isFinite(date.getTime())) { res.status(400).json({ error: "Invalid cursor" }); return; }
    older = or(lt(eventsTable.receivedAt, date), and(eq(eventsTable.receivedAt, date), lt(eventsTable.id, id)));
  }
  const rows = await db.select({ event: eventsTable, webhookName: webhooksTable.name }).from(eventsTable)
    .innerJoin(webhooksTable, eq(eventsTable.webhookId, webhooksTable.id))
    .where(and(eq(eventsTable.ownerId, res.locals.ownerId), older,
      query.data.view === "notes" ? and(
        sql`length(trim(coalesce(${eventsTable.transcription}, ''))) > 0`,
        exists(db.select({ id: jobsTable.eventId }).from(jobsTable).where(and(
          eq(jobsTable.eventId, eventsTable.id), eq(jobsTable.ownerId, res.locals.ownerId), eq(jobsTable.status, "completed"),
        ))),
        notExists(db.select({ id: itemsTable.id }).from(itemsTable).where(and(
          eq(itemsTable.sourceEventId, eventsTable.id), eq(itemsTable.ownerId, res.locals.ownerId),
        ))),
      ) : undefined,
    ))
    .orderBy(desc(eventsTable.receivedAt), desc(eventsTable.id)).limit(51);
  const items = rows.slice(0, 50).map(({ event, webhookName }) => ({
    id: event.id, webhookId: event.webhookId, webhookName, receivedAt: event.receivedAt.toISOString(),
    recordedAt: event.recordedAt?.toISOString() ?? null, kind: event.kind,
    transcription: event.transcription, audioSize: event.audioSize,
    audioUrl: event.audioPath ? `/api/events/${event.id}/audio` : null, payload: event.payload,
  }));
  const last = items.at(-1);
  res.json(ListEventsResponse.parse({ items, nextCursor: rows.length > 50 && last ? `${last.receivedAt}|${last.id}` : null }));
});

router.get("/events/:id/audio", async (req, res): Promise<void> => {
  const params = GetEventAudioParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid event" }); return; }
  const [event] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, params.data.id), eq(eventsTable.ownerId, res.locals.ownerId)));
  if (!event?.audioPath || !event.audioSize) { res.status(404).json({ error: "Audio not found" }); return; }
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
