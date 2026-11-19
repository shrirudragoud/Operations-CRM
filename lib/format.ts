// Display helpers: money in INR (en-IN grouping), dates in Asia/Kolkata. Storage stays UTC.
const TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});

export function formatINR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? inr.format(n) : "-";
}

/** Timestamps (timestamptz ISO strings) shown in IST. Plain dates (yyyy-mm-dd) are shown as-is. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : dateTimeFmt.format(d);
}

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** "9:30 am" for a timestamp, in India. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : timeFmt.format(d);
}

/** "5 Dec 2026, 9:30 am to 3:30 pm" for one day, or both full timestamps across days. */
export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "Date not set";
  if (!end) return formatDateTime(start);
  if (todayIST(new Date(start)) === todayIST(new Date(end))) return `${formatDateTime(start)} to ${timeFmt.format(new Date(end))}`;
  return `${formatDateTime(start)} to ${formatDateTime(end)}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** True when an ISO timestamp is now or earlier. */
export function isPast(value: string): boolean {
  return new Date(value).getTime() <= Date.now();
}

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's calendar date in India as yyyy-mm-dd. */
export function todayIST(now: Date = new Date()): string {
  return ymdFmt.format(now);
}
