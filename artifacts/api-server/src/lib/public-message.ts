import type { eventsTable } from "@workspace/db";

/** One message contract for list/detail and both clients. Legacy fields stay compatible. */
export function publicMessage(event: typeof eventsTable.$inferSelect, webhookName: string | null) {
  const text = event.deletedAt ? null : event.transcription;
  const audioUrl = !event.deletedAt && event.audioPath ? `/api/events/${event.id}/audio` : null;
  const sourceType = event.sourceType === "legacy" ? (event.webhookId ? "pebble" : "manual") : event.sourceType;
  return {
    id: event.id, webhookId: event.webhookId, webhookName: webhookName ?? (sourceType === "manual" ? "Manual" : sourceType),
    receivedAt: event.receivedAt.toISOString(), recordedAt: event.recordedAt?.toISOString() ?? null,
    deletedAt: event.deletedAt?.toISOString() ?? null, kind: event.kind,
    source: { type: sourceType, connectionId: event.sourceConnection ?? event.webhookId, externalId: event.sourceExternalId },
    text, transcription: text, audioUrl, audioSize: event.deletedAt ? null : event.audioSize,
    attachments: audioUrl ? [{ kind: "audio" as const, url: audioUrl, contentType: "audio/mp4", size: event.audioSize }] : [],
    payload: event.deletedAt ? {} : event.payload,
  };
}
