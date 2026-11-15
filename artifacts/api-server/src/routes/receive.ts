import express, { Router, type IRouter } from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { db, eventsTable, webhooksTable, jobsTable, appSettingsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ReceiveWebhookParams, ReceiveWebhookBody } from "@workspace/api-zod";
import { audioFile, saveAudio } from "../lib/recording-storage";

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 20, fieldSize: 512 * 1024, parts: 21 },
});
const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

// Discard credential-like keys from the inspector. Never capture request headers.
function redact(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[depth limit]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, /authorization|cookie|password|secret|token|api.?key/i.test(key) ? "[redacted]" : redact(item, depth + 1),
    ]));
  }
  return value;
}

router.post("/receive/:id", limiter, async (req, res, next): Promise<void> => {
  const params = ReceiveWebhookParams.safeParse(req.params);
  const token = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!params.success || !token) { res.status(401).json({ error: "Invalid webhook credentials" }); return; }
  const [hook] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, params.data.id));
  if (!hook || hook.revokedAt || !timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(hook.tokenHash, "hex"))) {
    res.status(401).json({ error: "Invalid webhook credentials" }); return;
  }
  const [app] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  if (app && !app.allowSignups && app.ownerId !== hook.ownerId) {
    res.status(403).json({ error: "This workspace is private" }); return;
  }
  res.locals.webhook = hook;
  next();
}, (req, res, next) => {
  if (req.is("multipart/form-data")) upload.single("audio")(req, res, next);
  else if (req.is("application/json")) express.json({ limit: "512kb" })(req, res, next);
  else res.status(415).json({ error: "Use application/json or multipart/form-data" });
}, async (req, res): Promise<void> => {
  const hook = res.locals.webhook as typeof webhooksTable.$inferSelect;
  const parsed = ReceiveWebhookBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Expected an object payload" }); return; }
  const body = parsed.data;
  const file = req.file;
  const multipart = Boolean(req.is("multipart/form-data"));
  if (multipart && !file && typeof body.transcription !== "string") {
    res.status(400).json({ error: "A recording needs audio or transcription" }); return;
  }
  if (file && (!["audio/mp4", "audio/x-m4a", "audio/m4a"].includes(file.mimetype) ||
    file.buffer.length < 12 || file.buffer.toString("ascii", 4, 8) !== "ftyp")) {
    res.status(400).json({ error: "Audio must be an M4A/MP4 file" }); return;
  }
  let recordedAt: Date | null = null;
  if (body.recordedAt !== undefined) {
    const time = Number(body.recordedAt);
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(new Date(time).getTime())) {
      res.status(400).json({ error: "recordedAt must be Unix milliseconds" }); return;
    }
    recordedAt = new Date(time);
  }
  const id = randomUUID();
  const receivedAt = new Date();
  const audioPath = file ? await saveAudio(file.buffer) : null;
  try {
    const accepted = await db.transaction(async (tx) => {
      // Recheck credentials while holding the row lock. A request uploading audio
      // when its webhook is revoked must not insert an event after revocation.
      const [active] = await tx.update(webhooksTable).set({
        lastReceivedAt: receivedAt, eventCount: sql`${webhooksTable.eventCount} + 1`,
      }).where(and(
        eq(webhooksTable.id, hook.id), isNull(webhooksTable.revokedAt), eq(webhooksTable.tokenHash, hook.tokenHash),
      )).returning({ id: webhooksTable.id });
      if (!active) return false;
      await tx.insert(eventsTable).values({
        id, ownerId: hook.ownerId, webhookId: hook.id, receivedAt, recordedAt,
        kind: multipart ? "recording" : "json",
        transcription: typeof body.transcription === "string" ? body.transcription : null,
        audioPath, audioSize: file?.size ?? null,
        payload: redact(body) as Record<string, unknown>,
      });
      if (typeof body.transcription === "string" && body.transcription.trim()) {
        await tx.insert(jobsTable).values({ eventId: id, ownerId: hook.ownerId }).onConflictDoNothing();
      }
      // Delivered only after commit, so SSE readers can immediately fetch it.
      // Contains only the account identifier, never transcript or credentials.
      await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${hook.ownerId})`);
      return true;
    });
    if (!accepted) {
      if (audioPath) await audioFile(audioPath).delete().catch(() => req.log.warn("Could not remove a revoked webhook audio upload"));
      res.status(401).json({ error: "Invalid webhook credentials" });
      return;
    }
  } catch (error) {
    if (audioPath) await audioFile(audioPath).delete().catch(() => req.log.warn("Could not remove an uncommitted audio upload"));
    throw error;
  }
  res.status(201).json({ id, received: true });
});

export default router;
