// Saudi Arabia observes Asia/Riyadh (UTC+03:00) with no daylight saving, so a fixed offset is exact.
export const TZ = "Asia/Riyadh";
export const OFFSET_MIN = 180;
const MS_MIN = 60_000;

/** "2026-11-22" + "14:30" (local Riyadh) -> Date (UTC instant) */
export function localToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MIN * MS_MIN);
}

/** UTC instant -> { date: "YYYY-MM-DD", time: "HH:MM", weekday: 0..6, minutes } in Riyadh */
export function utcToLocal(t: Date) {
  const l = new Date(t.getTime() + OFFSET_MIN * MS_MIN);
  const date = l.toISOString().slice(0, 10);
  const time = l.toISOString().slice(11, 16);
  return { date, time, weekday: l.getUTCDay(), minutes: l.getUTCHours() * 60 + l.getUTCMinutes() };
}

export function todayLocal(now = new Date()): string {
  return utcToLocal(now).date;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "09:30" or "09:30:00" -> 570 */
export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

export function formatDateTime(t: Date | string, locale: "ar" | "en") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(t));
}
export function formatDate(t: Date | string, locale: "ar" | "en") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(typeof t === "string" && t.length === 10 ? new Date(t + "T12:00:00Z") : new Date(t));
}
export function formatTime(t: Date | string, locale: "ar" | "en") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}
