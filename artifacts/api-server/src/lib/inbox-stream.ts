import { pool } from "@workspace/db";
import type { Response } from "express";
import { logger } from "./logger";

// PostgreSQL notifications cross API instances; an in-memory publisher alone
// would miss deliveries handled by a different production instance.
const channel = "ring_inbox_changed";
const subscribers = new Map<Response, string>();
let listening: Promise<void> | undefined;

async function ensureListening() {
  if (!listening) {
    listening = (async () => {
      const client = await pool.connect();
      let released = false;
      const disconnect = () => {
        if (released) return;
        released = true;
        listening = undefined;
        client.release(true);
        for (const response of subscribers.keys()) response.end();
        subscribers.clear();
      };
      client.on("error", () => {
        logger.warn("Inbox notification connection lost; reconnecting streams");
        disconnect();
      });
      client.on("end", disconnect);
      client.on("notification", (notification) => {
        if (notification.channel !== channel || !notification.payload) return;
        for (const [response, ownerId] of subscribers) {
          if (ownerId === notification.payload && !response.destroyed) {
            if (!response.write("event: inbox-changed\ndata: {}\n\n")) response.end();
          }
        }
      });
      try {
        await client.query(`LISTEN ${channel}`);
      } catch (error) {
        disconnect();
        throw error;
      }
    })().catch((error) => {
      listening = undefined;
      throw error;
    });
  }
  await listening;
}

export async function openInboxStream(response: Response, ownerId: string) {
  await ensureListening();
  if (response.destroyed) return;
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "private, no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  subscribers.set(response, ownerId);
  response.write("retry: 3000\nevent: ready\ndata: {}\n\n");
  // Keep intermediaries from timing out an idle stream; no database polling.
  const heartbeat = setInterval(() => {
    if (!response.write(": keepalive\n\n")) response.end();
  }, 20_000);
  // Periodically reopen through Clerk so expired sessions cannot keep a
  // previously authorized stream indefinitely.
  const expiry = setTimeout(() => response.end(), 5 * 60_000);
  response.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    subscribers.delete(response);
  });
}
