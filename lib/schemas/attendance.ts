import { z } from "zod";

// Attendance forms (0023). The database re-checks every rule (ops.request_attendance, ops.decide_attendance_request,
// ops.correct_checkout, ops.declare_remote, ops.excuse_day); these give the form its messages before the round trip.

const ymd = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day.");
const hhmm = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 11:00.");
const reason = z.string().trim().min(3, "Say why, in a few words.").max(500, "Keep it under 500 characters.");

export const requestSchema = z
  .object({ work_date: ymd, in_time: hhmm, out_time: hhmm, reason })
  .refine((v) => v.out_time > v.in_time, { path: ["out_time"], message: "Leaving must be after arriving." });
export type RequestInput = z.input<typeof requestSchema>;

export const decideSchema = z.object({
  id: z.uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export const correctSchema = z.object({
  session_id: z.uuid(),
  work_date: ymd,
  out_time: hhmm,
  note: z.string().trim().min(3, "Say how you know when they left.").max(500),
});
export type CorrectInput = z.input<typeof correctSchema>;

export const remoteSchema = z.object({ date: ymd, reason });
export type RemoteInput = z.input<typeof remoteSchema>;

export const excuseSchema = z.object({ staff_id: z.uuid(), date: ymd, reason });
export type ExcuseInput = z.input<typeof excuseSchema>;

export const clearMarkSchema = z.object({ staff_id: z.uuid(), date: ymd });

export const tagSchema = z.object({ staff_id: z.uuid(), works_from_office: z.boolean() });

export const modeSchema = z.object({ staff_id: z.uuid(), attendance_mode: z.enum(["office", "remote"]) });

export const IP_HEADERS = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] as const;

export const settingsSchema = z
  .object({
    start_time: hhmm,
    end_time: hhmm,
    grace_minutes: z.coerce.number().int().min(0, "At least 0.").max(120, "At most 120."),
    work_days: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one working day."),
    flags_on: z.boolean(),
    ip_header: z.enum(IP_HEADERS),
    ip_hops: z.coerce.number().int().min(1).max(5),
  })
  .refine((v) => v.end_time > v.start_time, { path: ["end_time"], message: "Office hours must end after they start." });
export type SettingsInput = z.input<typeof settingsSchema>;
export type SettingsValues = z.output<typeof settingsSchema>;

export const holidaySchema = z.object({ holiday_date: ymd, name: z.string().trim().min(1, "Give it a name.").max(100) });
export type HolidayInput = z.input<typeof holidaySchema>;
export const idSchema = z.object({ id: z.uuid() });

export const networkSchema = z.object({
  label: z.string().trim().min(1, "Give it a name.").max(80),
  cidr: z.string().trim().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, "Enter an address like 203.0.113.10 or 203.0.113.0/24."),
});
export type NetworkInput = z.input<typeof networkSchema>;
export const networkActiveSchema = z.object({ id: z.uuid(), is_active: z.boolean() });
