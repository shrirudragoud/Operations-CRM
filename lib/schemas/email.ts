import { z } from "zod";

// What can be mailed. The ids match ops.email_group() in the database, which decides what each notification belongs to.
export const EMAIL_GROUPS = [
  { id: "assigned", label: "Assigned to me", hint: "A task is given to you, or a repeating task is created for you." },
  { id: "mentions", label: "Mentions", hint: "Someone mentions you in a comment." },
  { id: "due", label: "Due today and overdue", hint: "Your task is due today or has passed its date." },
  { id: "meetings", label: "Meetings", hint: "Invitations, changes, cancellations and reminders." },
  { id: "hr", label: "HR", hint: "Replies to your requests and files HR sends you." },
  { id: "activity", label: "Task activity", hint: "Comments, status and date changes on tasks you follow. Can be a lot." },
] as const;

export type EmailGroupId = (typeof EMAIL_GROUPS)[number]["id"];
// Mirrors ops.default_email_groups() and ops.default_push_groups(). Email leaves out "due": the Ops dashboard already shows it
// and the reminder repeats daily. Browser notifications get every topic.
export const DEFAULT_EMAIL_GROUPS: EmailGroupId[] = ["assigned", "mentions", "meetings", "hr", "activity"];
export const DEFAULT_PUSH_GROUPS: EmailGroupId[] = ["assigned", "mentions", "due", "meetings", "hr", "activity"];

export const emailPrefsSchema = z.object({
  enabled: z.boolean(),
  groups: z.array(z.enum(EMAIL_GROUPS.map((g) => g.id) as [EmailGroupId, ...EmailGroupId[]])).max(EMAIL_GROUPS.length),
});
export type EmailPrefsInput = z.infer<typeof emailPrefsSchema>;
