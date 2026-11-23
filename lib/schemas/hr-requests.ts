import { z } from "zod";
import { checkUpload } from "@/lib/schemas/documents";

export const REQUEST_KINDS = ["experience_letter", "address_proof", "salary_certificate", "detail_change", "other"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_LABELS: Record<RequestKind, string> = {
  experience_letter: "Experience letter",
  address_proof: "Address proof letter",
  salary_certificate: "Salary certificate",
  detail_change: "Change a detail HR holds",
  other: "Something else",
};

export const REQUEST_STATES = ["open", "in_progress", "done", "rejected"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};

export const requestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  subject: z.string().trim().min(1, "Say what you need.").max(140, "Keep the subject under 140 characters."),
  details: z.string().trim().max(2000, "Keep the details under 2000 characters."),
});
export type RequestInput = z.input<typeof requestSchema>;

/** The body may be empty when files are attached; requireMessage() decides. */
export const messageSchema = z.object({
  request_id: z.uuid(),
  body: z.string().trim().max(2000, "Keep the message under 2000 characters.").default(""),
  internal: z.boolean().default(false),
  keep_copy: z.boolean().default(false),
  finish: z.boolean().default(false),
});

export const MAX_FILES_PER_MESSAGE = 5;

/** A message needs words or at least one file. */
export function requireMessage(body: string, fileCount: number): string | null {
  return body.trim() === "" && fileCount === 0 ? "Write a message or attach a file." : null;
}

/** Checks a chosen list of files before upload: how many, how big, which type. The server checks the real content. */
export function checkAttachments(files: { name: string; size: number; type: string }[]): string | null {
  if (files.length > MAX_FILES_PER_MESSAGE) return `Attach at most ${MAX_FILES_PER_MESSAGE} files at a time.`;
  for (const f of files) {
    const c = checkUpload(f);
    if (!c.ok) return `${f.name}: ${c.error}`;
  }
  return null;
}

export const stateSchema = z.object({
  request_id: z.uuid(),
  state: z.enum(REQUEST_STATES),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters.").optional(),
});

export const ONBOARDING_KINDS = ["joiner", "leaver"] as const;
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];
export const ONBOARDING_LABELS: Record<OnboardingKind, string> = { joiner: "Joining", leaver: "Leaving" };
export const OWNER_LABELS = { hr: "HR", employee: "The person", lead: "Their lead" } as const;
export const OWNERS = ["hr", "employee", "lead"] as const;
export type OnboardingOwner = (typeof OWNERS)[number];

export const startOnboardingSchema = z.object({
  staff_id: z.uuid("Choose a person."),
  kind: z.enum(ONBOARDING_KINDS),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").or(z.literal("")),
});

export const templateSchema = z.object({
  kind: z.enum(ONBOARDING_KINDS),
  title: z.string().trim().min(1, "Give the step a title.").max(140, "Keep the title under 140 characters."),
  detail: z.string().trim().max(500, "Keep the detail under 500 characters."),
  owner: z.enum(OWNERS),
  due_offset: z.coerce.number().int("Use whole days.").min(-60, "At most 60 days before.").max(60, "At most 60 days after."),
});
