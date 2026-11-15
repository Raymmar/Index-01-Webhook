import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** UTC ISO -> "yyyy-MM-ddTHH:mm" wall time in tz, for datetime-local inputs. */
export function toLocalInput(iso: string | null, tz: string): string {
  if (!iso) return "";
  return formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd'T'HH:mm");
}

/** datetime-local value interpreted in tz -> UTC ISO. Throws on invalid or nonexistent (DST gap) local times. */
export function fromLocalInput(value: string, tz: string): string | null {
  if (!value) return null;
  const d = fromZonedTime(value, tz);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  if (toLocalInput(d.toISOString(), tz) !== value.slice(0, 16)) throw new Error("That time does not exist in this timezone");
  return d.toISOString();
}

export function tryLocalInput(value: string, tz: string): { iso: string | null; error?: string } {
  try { return { iso: fromLocalInput(value, tz) }; }
  catch (e) { return { iso: null, error: e instanceof Error && e.message.includes("exist") ? "That time doesn’t exist here (clock change)." : "Invalid date." }; }
}

export function formatDue(iso: string, tz: string): string {
  return formatInTimeZone(new Date(iso), tz, "EEE, MMM d · h:mm a");
}

export function zones(): string[] {
  const s = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try { return [...new Set(["UTC", ...(s ? s("timeZone") : [browserZone()])])]; } catch { return [...new Set(["UTC", browserZone()])]; }
}
