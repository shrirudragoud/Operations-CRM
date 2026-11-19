import { z } from "zod";
import { todayIST } from "@/lib/format";

// Time tracking and the daily log (0020). The database re-checks every rule (ops.time_entry_guard,
// ops.daily_log_guard): the day window, the 24-hour cap, one running timer, who may edit.

export const TIME_EDIT_DAYS = 14;
export const TIME_BACKFILL_DAYS = 30;
export const LOG_BACKFILL_DAYS = 7;

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** "90", "90m", "1h", "1.5h", "1h30", "1h 30m", "1:30" -> minutes, or null when it can't be read. */
export function parseDuration(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isInteger(input) && input > 0 ? input : null;
  const s = (input ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):([0-5]?\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+)(?:h|hr|hrs|hour|hours)(?:(\d+)(?:m|min|mins)?)?$/))) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  if ((m = s.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)$/))) return Math.round(Number(m[1]) * 60);
  if ((m = s.match(/^(\d+)(?:m|min|mins|minutes?)?$/))) return Number(m[1]);
  return null;
}

const duration = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const n = parseDuration(v);
    if (n === null || n < 1) {
      ctx.addIssue({ code: "custom", message: "Enter a length like 45, 1h 30m or 1.5h." });
      return z.NEVER;
    }
    if (n > 960) {
      ctx.addIssue({ code: "custom", message: "One entry can be at most 16 hours." });
      return z.NEVER;
    }
    return n;
  });

const workDate = z
  .string()
  .trim()
  .regex(ymd, "Pick the day you worked.")
  .refine((v) => v <= todayIST(), "You can't log time for a future day.");

const note = z
  .string()
  .trim()
  .max(500, "Keep the note under 500 characters.")
  .optional()
  .transform((v) => (v ? v : null));

export const startTimerSchema = z.object({ task_id: z.uuid() });
export const stopTimerSchema = z.object({ id: z.uuid() });

export const manualEntrySchema = z.object({ task_id: z.uuid(), work_date: workDate, minutes: duration, note });
export type ManualEntryInput = z.input<typeof manualEntrySchema>;
export type ManualEntryValues = z.output<typeof manualEntrySchema>;

export const updateEntrySchema = z.object({ id: z.uuid(), work_date: workDate, minutes: duration, note });
export const deleteEntrySchema = z.object({ id: z.uuid() });
export const timerNoteSchema = z.object({ id: z.uuid(), note });

const optionalLong = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : null));

export const dailyLogSchema = z.object({
  log_date: z
    .string()
    .trim()
    .regex(ymd, "Pick a day.")
    .refine((v) => v <= todayIST(), "You can't write the log for a future day."),
  did: z.string().trim().min(1, "Write what you did.").max(4000, "Keep this under 4000 characters."),
  next_up: optionalLong(2000),
  blockers: optionalLong(2000),
});
export type DailyLogInput = z.input<typeof dailyLogSchema>;

/** The Monday of the week containing the given yyyy-mm-dd. */
export function weekStart(ymdStr: string): string {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function weekDays(start: string): string[] {
  const d = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

export function parseWeek(raw: string | string[] | undefined, today: string = todayIST()): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return weekStart(v && ymd.test(v) && !Number.isNaN(Date.parse(v)) ? v : today);
}

/** Elapsed minutes for a running timer (rounded down, never negative). */
export function elapsedMinutes(startedAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
}

/** "1h 05m" / "45m"; zero shows as "0m". */
export function formatHM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
