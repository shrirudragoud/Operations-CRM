import { z } from "zod";

// Leave forms (0032). The database re-checks every rule (ops.apply_leave, decide_leave, cancel_leave, hr_adjust_balance and the
// leave_type table); these give each form its messages before the round trip.

const ymd = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day.");
const why = z.string().trim().min(3, "Say why, in a few words.").max(500, "Keep it under 500 characters.");
const days = (label: string) => z.coerce.number({ error: `Enter ${label} as a number.` });

export const DAY_PARTS = ["full", "first_half", "second_half"] as const;
export const DAY_PART_LABELS: Record<(typeof DAY_PARTS)[number], string> = {
  full: "Whole day", first_half: "First half", second_half: "Second half",
};

export const applySchema = z
  .object({
    leave_type_id: z.uuid("Choose a type of leave."),
    from_date: ymd,
    to_date: ymd,
    day_part: z.enum(DAY_PARTS),
    reason: why,
    staff_id: z.uuid().nullish(),
  })
  .refine((v) => v.to_date >= v.from_date, { path: ["to_date"], message: "The last day is before the first." })
  .refine((v) => v.from_date.slice(0, 4) === v.to_date.slice(0, 4), { path: ["to_date"], message: "Apply for one calendar year at a time." })
  .refine((v) => v.day_part === "full" || v.from_date === v.to_date, { path: ["day_part"], message: "A half day is for a single day." });
export type ApplyInput = z.input<typeof applySchema>;

export const idSchema = z.object({ id: z.uuid() });

export const decideSchema = z
  .object({ id: z.uuid(), approve: z.boolean(), note: z.string().trim().max(500, "Keep it under 500 characters.").optional() })
  .refine((v) => v.approve || (v.note?.length ?? 0) >= 3, { path: ["note"], message: "Say why you are turning it down." });

export const adjustSchema = z.object({
  staff_id: z.uuid("Choose a person."),
  leave_type_id: z.uuid("Choose a type of leave."),
  year: z.coerce.number().int().min(2000).max(2200),
  days: days("days").refine((n) => n !== 0, "Enter a number of days other than zero.").refine((n) => Math.abs(n) <= 366, "That is too many days."),
  note: why,
});
export type AdjustInput = z.input<typeof adjustSchema>;

const quota = (label: string) => days(label).min(0, "It cannot be negative.").max(366, "That is more than a year.");

export const leaveTypeSchema = z.object({
  id: z.uuid().nullish(),
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,23}$/, "Use 2 to 24 lower-case letters, digits or underscores, starting with a letter.").nullish(),
  name: z.string().trim().min(1, "Give it a name.").max(60, "Keep it under 60 characters."),
  paid: z.boolean(),
  has_balance: z.boolean(),
  annual_quota: quota("the days a year"),
  carry_forward: z.boolean(),
  carry_cap: z.union([z.literal(""), z.null(), quota("the cap")]).transform((v) => (v === "" || v === null ? null : v)),
  count_weekends: z.boolean(),
  count_holidays: z.boolean(),
  half_day_allowed: z.boolean(),
  needs_document: z.boolean(),
  is_active: z.boolean(),
});
export type LeaveTypeInput = z.input<typeof leaveTypeSchema>;

export const holidaySchema = z.object({ holiday_date: ymd, name: z.string().trim().min(1, "Give it a name.").max(100) });
export type HolidayInput = z.input<typeof holidaySchema>;

export const yearSchema = z.object({ year: z.coerce.number().int().min(2000).max(2200).optional() });
