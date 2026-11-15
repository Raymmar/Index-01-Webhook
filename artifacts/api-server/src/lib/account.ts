import { db, appSettingsTable, preferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function accountFor(userId: string) {
  // The singleton primary key makes first-login ownership atomic across instances.
  await db.insert(appSettingsTable).values({ id: 1, ownerId: userId }).onConflictDoNothing();
  const [app] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  if (!app) throw new Error("App settings unavailable");
  const isOwner = app.ownerId === userId;
  const allowed = isOwner || app.allowSignups;
  if (allowed) await db.insert(preferencesTable).values({ ownerId: userId }).onConflictDoNothing();
  const [preferences] = await db.select().from(preferencesTable).where(eq(preferencesTable.ownerId, userId));
  return { app, isOwner, allowed, timezone: preferences?.timezone ?? null };
}

export function validTimezone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

export function parseInstant(value: string | null | undefined) {
  if (value == null) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error("A UTC or offset date is required");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid date");
  return date;
}
