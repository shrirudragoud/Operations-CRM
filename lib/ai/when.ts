// Dates and times the way tool results show them: India time, "Fri 28 Nov", "10:30 am - 11:30 am".

import { addDays, dayStartIso, formatTimeRange, isYmd } from "@/lib/schemas/calendar";
import { istDay } from "@/lib/schemas/event";

const short = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

export const dayLabel = (ymd: string): string => short.format(new Date(`${ymd}T00:00:00Z`));

export const clip = (text: string, n: number): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A YYYY-MM-DD day from a tool argument, or null when it is missing or not a real day. */
export const dayArg = (v: unknown): string | null => (typeof v === "string" && isYmd(v) ? v : null);

export type Span = { starts_at: string; ends_at: string; allDay?: boolean };

export function whenOf(s: Span): { date: string; time: string } {
  return { date: `${istDay(s.starts_at)} (${dayLabel(istDay(s.starts_at))})`, time: s.allDay ? "all day" : formatTimeRange(s.starts_at, s.ends_at) };
}

/** True when the span touches any day from `from` to `to` inclusive. */
export const touches = (s: Span, from: string, to: string): boolean => s.starts_at < dayStartIso(addDays(to, 1)) && s.ends_at > dayStartIso(from);
