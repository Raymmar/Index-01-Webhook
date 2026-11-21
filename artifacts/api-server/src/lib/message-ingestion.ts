import { createHash, randomUUID } from "node:crypto";
import { db, eventsTable, messageOutboxTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export type MessageTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type IncomingMessage = {
  ownerId: string;
  sourceType: string;
  sourceConnection: string;
  externalId?: string | null;
  text: string | null;
  occurredAt: Date | null;
  payload: Record<string, unknown>;
  webhookId?: string;
  kind: "recording" | "json";
  audio?: { path: string; size: number; hash: string };
  initialized?: boolean;
};
export class DeliveryConflict extends Error {}

export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[depth limit]";
  if (Array.isArray(value)) return value.map(item => redactMetadata(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /authorization|cookie|password|secret|token|api.?key/i.test(key) ? "[redacted]" : redactMetadata(item, depth + 1),
  ]));
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

/** Save the original plus its durable receipt; never touch an AI queue here. */
export async function ingestMessage(tx: MessageTransaction, message: IncomingMessage) {
  const payload = redactMetadata(message.payload) as Record<string, unknown>;
  const hash = createHash("sha256").update(canonical({
    text: message.text, occurredAt: message.occurredAt?.toISOString() ?? null,
    kind: message.kind, audio: message.audio?.hash ?? null, payload,
  })).digest("hex");
  const [created] = await tx.insert(eventsTable).values({
    id: randomUUID(), ownerId: message.ownerId, webhookId: message.webhookId ?? null,
    sourceType: message.sourceType, sourceConnection: message.sourceConnection,
    sourceExternalId: message.externalId ?? null, ingestionHash: hash,
    transcription: message.text, recordedAt: message.occurredAt, payload,
    kind: message.kind, audioPath: message.audio?.path ?? null, audioSize: message.audio?.size ?? null,
    unifiedAt: new Date(), actionsInitializedAt: message.initialized ? new Date() : null,
    editedAt: message.initialized ? new Date() : null,
  }).onConflictDoNothing().returning();
  if (!created) {
    if (!message.externalId) throw new Error("Message insert failed");
    const [existing] = await tx.select().from(eventsTable).where(and(
      eq(eventsTable.ownerId, message.ownerId), eq(eventsTable.sourceType, message.sourceType),
      eq(eventsTable.sourceConnection, message.sourceConnection), eq(eventsTable.sourceExternalId, message.externalId),
    ));
    if (!existing || existing.ingestionHash !== hash) throw new DeliveryConflict("Delivery identifier already used with different content");
    // Do not resurrect deleted messages, redo processing, or bump delivery counts.
    return { id: existing.id, receivedAt: existing.receivedAt, inserted: false };
  }
  await tx.insert(messageOutboxTable).values({ eventId: created.id, ownerId: message.ownerId });
  await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${message.ownerId})`);
  return { id: created.id, receivedAt: created.receivedAt, inserted: true };
}
