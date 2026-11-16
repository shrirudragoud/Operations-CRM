import { z } from "zod";
import { Constants } from "@/lib/db.types";

// Shared by the forms (zodResolver) and the Server Actions. The database re-validates everything.

export const INSTITUTION_KINDS = ["school", "engineering_college", "polytechnic", "university", "other"] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

export const KIND_LABELS: Record<InstitutionKind, string> = {
  school: "School",
  engineering_college: "Engineering college",
  polytechnic: "Polytechnic",
  university: "University",
  other: "Other",
};

/** Lifecycle order matters: the database only lets a stage move forward (guard_institution_stage). */
export const STAGES = Constants.ops.Enums.lifecycle_stage;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  qualified: "Qualified",
  deal_won: "Deal won",
  workshop_delivered: "Workshop delivered",
  teachers_trained: "Teachers trained",
  active: "Active",
  lab_customer: "Lab customer",
  renewal: "Renewal",
  churned: "Churned",
};

export const INFLUENCES = ["decision_maker", "influencer", "user", "other"] as const;
export type Influence = (typeof INFLUENCES)[number];
export const INFLUENCE_LABELS: Record<Influence, string> = {
  decision_maker: "Decision maker",
  influencer: "Influencer",
  user: "User",
  other: "Other",
};

/** Optional text: trimmed, empty becomes null so the column stays NULL rather than ''. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep ${label} under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

export const institutionSchema = z.object({
  name: z.string().trim().min(1, "Enter the institution's name.").max(200, "Keep the name under 200 characters."),
  kind: z.enum(INSTITUTION_KINDS, { message: "Choose a kind." }),
  affiliation: optionalText(200, "the affiliation"),
  city: optionalText(100, "the city"),
  district: optionalText(100, "the district"),
  state: optionalText(100, "the state"),
  source: optionalText(100, "the source"),
  notes: optionalText(4000, "the notes"),
  owner_id: z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v)),
});
export type InstitutionInput = z.input<typeof institutionSchema>;
export type InstitutionValues = z.output<typeof institutionSchema>;

export const updateInstitutionSchema = institutionSchema.extend({ id: z.uuid() });
export type UpdateInstitutionInput = z.input<typeof updateInstitutionSchema>;

export const institutionIdSchema = z.object({ id: z.uuid() });

export const correctStageSchema = z.object({
  id: z.uuid(),
  stage: z.enum(STAGES, { message: "Choose a stage." }),
});

const phone = z
  .string()
  .trim()
  .max(20, "Keep the phone number under 20 characters.")
  .refine((v) => v === "" || /^[+\d][\d\s().-]{5,}$/.test(v), "Enter a valid phone number.")
  .transform((v) => (v === "" ? null : v));

export const contactSchema = z.object({
  full_name: z.string().trim().min(1, "Enter the contact's name.").max(120, "Keep the name under 120 characters."),
  designation: optionalText(120, "the designation"),
  influence: z.union([z.literal(""), z.enum(INFLUENCES)]).transform((v) => (v === "" ? null : v)),
  phone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address.")
    .transform((v) => (v === "" ? null : v)),
});
export type ContactInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;

export const createContactSchema = contactSchema.extend({ institution_id: z.uuid() });
export const updateContactSchema = contactSchema.extend({ id: z.uuid(), institution_id: z.uuid() });
export const deleteContactSchema = z.object({ id: z.uuid(), institution_id: z.uuid() });

// ---------------------------------------------------------------- list URL state

export const PAGE_SIZE = 25;
export const ARCHIVED_MODES = ["hide", "only", "all"] as const;
export type ArchivedMode = (typeof ARCHIVED_MODES)[number];

export const SORT_COLUMNS = ["name", "city", "stage", "updated_at"] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export type ListParams = {
  page: number;
  q: string;
  stage: Stage | null;
  kind: InstitutionKind | null;
  district: string;
  /** A staff uuid, or "none" for unassigned. */
  owner: string | null;
  archived: ArchivedMode;
  sort: SortColumn;
  desc: boolean;
};

export const DEFAULT_LIST_PARAMS: ListParams = {
  page: 1, q: "", stage: null, kind: null, district: "", owner: null, archived: "hide", sort: "name", desc: false,
};

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** Characters that would change meaning inside a PostgREST `or()` / ilike pattern. */
export function cleanSearch(q: string): string {
  return q.replace(/[%_*,()\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Parse untrusted URL search params into safe list parameters; anything invalid falls back to the default. */
export function parseListParams(raw: Raw): ListParams {
  const page = Number.parseInt(first(raw.page), 10);
  const stage = first(raw.stage);
  const kind = first(raw.kind);
  const owner = first(raw.owner);
  const archived = first(raw.archived);
  const sortRaw = first(raw.sort);
  const desc = sortRaw.startsWith("-");
  const sort = sortRaw.replace(/^-/, "");

  return {
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    q: cleanSearch(first(raw.q)),
    stage: (STAGES as readonly string[]).includes(stage) ? (stage as Stage) : null,
    kind: (INSTITUTION_KINDS as readonly string[]).includes(kind) ? (kind as InstitutionKind) : null,
    district: cleanSearch(first(raw.district)),
    owner: owner === "none" || z.uuid().safeParse(owner).success ? owner : null,
    archived: (ARCHIVED_MODES as readonly string[]).includes(archived) ? (archived as ArchivedMode) : "hide",
    sort: (SORT_COLUMNS as readonly string[]).includes(sort) ? (sort as SortColumn) : "name",
    desc: (SORT_COLUMNS as readonly string[]).includes(sort) ? desc : false,
  };
}

/** Serialise list parameters back to a query string, omitting defaults so URLs stay short. */
export function listQuery(p: Partial<ListParams>): string {
  const full = { ...DEFAULT_LIST_PARAMS, ...p };
  const sp = new URLSearchParams();
  if (full.page > 1) sp.set("page", String(full.page));
  if (full.q) sp.set("q", full.q);
  if (full.stage) sp.set("stage", full.stage);
  if (full.kind) sp.set("kind", full.kind);
  if (full.district) sp.set("district", full.district);
  if (full.owner) sp.set("owner", full.owner);
  if (full.archived !== "hide") sp.set("archived", full.archived);
  if (full.sort !== "name" || full.desc) sp.set("sort", `${full.desc ? "-" : ""}${full.sort}`);
  return sp.toString();
}
