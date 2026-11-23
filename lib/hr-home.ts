import { STAFF_DOC_LABELS, expiryLabel, type StaffDocKind } from "@/lib/schemas/documents";

export type ActionKind = "leave" | "request" | "document" | "expiring" | "onboarding";

export type ActionRow = {
  kind: string;
  ref_id: string;
  staff_id: string;
  full_name: string;
  title: string;
  detail: string;
  since: string | null;
  due_on: string | null;
  urgent: boolean;
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  leave: "Leave to approve",
  request: "Request to answer",
  document: "Paper to verify",
  expiring: "Paper expiring",
  onboarding: "Checklist step",
};

export const ACTION_HREFS: Record<ActionKind, string> = {
  leave: "/hr/leave",
  request: "/hr/requests",
  document: "/hr/documents",
  expiring: "/hr/documents",
  onboarding: "/hr/onboarding",
};

export function isActionKind(k: string): k is ActionKind {
  return k in ACTION_LABELS;
}

/** Whole days from one yyyy-mm-dd date to another (b minus a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const ymd = (iso: string): string => iso.slice(0, 10);

/** The ISO timestamp as an India calendar date; callers pass `since` through this before comparing days. */
function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "Waiting 3 days", "Expires in 5 days", "Overdue by 2 days" - how long this has been on HR's plate. */
export function waitLabel(row: Pick<ActionRow, "kind" | "since" | "due_on">, today: string): string {
  if (row.kind === "expiring" && row.due_on) return expiryLabel(daysBetween(today, ymd(row.due_on)));
  if (row.kind === "onboarding" && row.due_on) {
    const late = daysBetween(ymd(row.due_on), today);
    if (late > 0) return `Overdue by ${late} day${late === 1 ? "" : "s"}`;
    return "Due today";
  }
  if (row.since) {
    const days = daysBetween(istDate(row.since), today);
    if (days <= 0) return "Waiting since today";
    return `Waiting ${days} day${days === 1 ? "" : "s"}`;
  }
  return "";
}

/** What kind of paper or step it is, in words a person would use. */
export function actionDetail(row: Pick<ActionRow, "kind" | "detail">): string {
  if (row.kind === "document" || row.kind === "expiring") return STAFF_DOC_LABELS[row.detail as StaffDocKind] ?? row.detail;
  if (row.kind === "request") return REQUEST_LABELS[row.detail] ?? row.detail;
  if (row.kind === "onboarding") {
    const [kind, owner] = row.detail.split(" - ");
    return `${kind === "leaver" ? "Leaving" : "Joining"} · ${OWNER_LABELS[owner ?? ""] ?? owner ?? ""}`;
  }
  return row.detail;
}

const REQUEST_LABELS: Record<string, string> = {
  experience_letter: "Experience letter",
  address_proof: "Address proof",
  salary_certificate: "Salary certificate",
  detail_change: "Change of details",
  other: "Other",
};

const OWNER_LABELS: Record<string, string> = { hr: "HR", employee: "The person", lead: "Their lead" };

export type OverviewRow = { list: string; staff_id: string; full_name: string; on_date: string; detail: string };
export const OVERVIEW_LISTS = ["on_leave", "joining", "leaving", "probation", "setup_gap", "birthday", "anniversary"] as const;
export type OverviewList = (typeof OVERVIEW_LISTS)[number];

export function groupOverview(rows: OverviewRow[]): Record<OverviewList, OverviewRow[]> {
  const out = Object.fromEntries(OVERVIEW_LISTS.map((l) => [l, [] as OverviewRow[]])) as Record<OverviewList, OverviewRow[]>;
  for (const r of rows) if ((OVERVIEW_LISTS as readonly string[]).includes(r.list)) out[r.list as OverviewList].push(r);
  return out;
}

/** "In 3 days", "Today", "Tomorrow" for the birthdays and anniversaries list. */
export function inDaysLabel(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d <= 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `In ${d} days`;
}
