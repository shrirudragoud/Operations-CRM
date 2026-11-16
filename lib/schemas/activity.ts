import { z } from "zod";
import { todayIST } from "@/lib/format";
import { cleanSearch } from "@/lib/schemas/institution";

// Shared by the Log activity form and the Server Action. The database re-validates everything
// (check constraints on kind/outcome, the on_activity trigger for stage, deal and follow-up task).

export const ACTIVITY_KINDS = ["visit", "call", "email", "whatsapp", "stem_class", "event_booth"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const KIND_LABELS: Record<ActivityKind, string> = {
  visit: "Visit",
  call: "Call",
  email: "Email",
  whatsapp: "WhatsApp",
  stem_class: "STEM class",
  event_booth: "Event booth",
};

export const OUTCOMES = ["no_answer", "interested", "not_interested", "follow_up", "qualified"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_answer: "No answer",
  interested: "Interested",
  not_interested: "Not interested",
  follow_up: "Follow up",
  qualified: "Qualified",
};

const ymd = /^\d{4}-\d{2}-\d{2}$/;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep ${label} under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const optionalDate = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || ymd.test(v), message)
    .transform((v) => (v === "" ? null : v));

export const activitySchema = z
  .object({
    institution_id: z.uuid({ message: "Choose an institution." }),
    contact_id: z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v)),
    kind: z.enum(ACTIVITY_KINDS, { message: "Choose what you did." }),
    outcome: z.union([z.literal(""), z.enum(OUTCOMES)]).transform((v) => (v === "" ? null : v)),
    notes: optionalText(4000, "the notes"),
    happened_on: optionalDate("Enter a valid date."),
    next_step: optionalText(300, "the next step"),
    next_step_due: optionalDate("Enter a valid due date."),
  })
  .superRefine((v, ctx) => {
    const today = todayIST();
    if (v.happened_on && v.happened_on > today) {
      ctx.addIssue({ code: "custom", path: ["happened_on"], message: "That date is in the future." });
    }
    if (v.next_step && !v.next_step_due) {
      ctx.addIssue({ code: "custom", path: ["next_step_due"], message: "Pick a due date so a follow-up task is created." });
    }
    if (v.next_step_due && !v.next_step) {
      ctx.addIssue({ code: "custom", path: ["next_step"], message: "Say what the next step is." });
    }
    if (v.next_step_due && v.next_step_due < today) {
      ctx.addIssue({ code: "custom", path: ["next_step_due"], message: "The due date can't be in the past." });
    }
  });
export type ActivityInput = z.input<typeof activitySchema>;
export type ActivityValues = z.output<typeof activitySchema>;

/** The timestamp stored for an activity: now unless the user backdated it (noon IST that day). */
export function happenedAtFor(happenedOn: string | null, today: string = todayIST()): string | null {
  if (!happenedOn || happenedOn === today) return null;
  return `${happenedOn}T12:00:00+05:30`;
}

export const TASK_STATUSES = ["todo", "doing", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const setTaskStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES, { message: "Choose a status." }),
});

// ---------------------------------------------------------------- Outreach list params (URL state)

export const OUTREACH_TABS = ["followups", "territory", "history"] as const;
export type OutreachTab = (typeof OUTREACH_TABS)[number];
export const OUTREACH_PAGE_SIZE = 25;

export const TOUCH_FILTERS = ["all", "untouched", "cold"] as const;
export type TouchFilter = (typeof TOUCH_FILTERS)[number];
export const COLD_AFTER_DAYS = 30;

export type OutreachParams = {
  tab: OutreachTab;
  scope: "mine" | "all";
  segment: "" | "school" | "college" | "other";
  touch: TouchFilter;
  district: string;
  page: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseOutreachParams(raw: Record<string, string | string[] | undefined>): OutreachParams {
  const tab = first(raw.tab);
  const segment = first(raw.segment);
  const touch = first(raw.touch);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    tab: (OUTREACH_TABS as readonly string[]).includes(tab) ? (tab as OutreachTab) : "followups",
    scope: first(raw.scope) === "all" ? "all" : "mine",
    segment: segment === "school" || segment === "college" || segment === "other" ? segment : "",
    touch: (TOUCH_FILTERS as readonly string[]).includes(touch) ? (touch as TouchFilter) : "all",
    district: cleanSearch(first(raw.district)),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export function outreachQuery(p: Partial<OutreachParams>): string {
  const qs = new URLSearchParams();
  if (p.tab && p.tab !== "followups") qs.set("tab", p.tab);
  if (p.scope === "all") qs.set("scope", "all");
  if (p.segment) qs.set("segment", p.segment);
  if (p.touch && p.touch !== "all") qs.set("touch", p.touch);
  if (p.district) qs.set("district", p.district);
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  return qs.toString();
}
