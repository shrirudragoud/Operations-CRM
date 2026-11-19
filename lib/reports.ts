// Reports: the shapes and the counting. A report is a titled table that is the same whether it is shown on a page, downloaded
// as CSV or (later) emailed by a job. The queries that feed these functions live in lib/queries/reports.ts and run as the
// signed-in person, so row-level security decides which rows are counted. Days are India calendar days (yyyy-mm-dd).
import { monthBounds, summarise, dayStatus, type DayRow, type OfficeSettings } from "@/lib/attendance";
import { toCsv } from "@/lib/csv/export";
import { todayIST } from "@/lib/format";
import { isOpen, type TaskRow } from "@/lib/ops-insight";
import { canAccess, canSeeTeamAttendance, isHr, type Area, type Me } from "@/lib/permissions";
import { DEAL_STAGE_LABELS, STAGE_PROBABILITY, type DealStage } from "@/lib/schemas/deal";
import { STAGES, STAGE_LABELS } from "@/lib/schemas/institution";
import { addDays } from "@/lib/task-layout";

export const REPORT_KEYS = ["pipeline", "institutions", "timeliness", "time", "attendance", "leave"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const isReportKey = (v: string): v is ReportKey => (REPORT_KEYS as readonly string[]).includes(v);

type Meta = { title: string; description: string; area: Area; maxDays: number };

export const MAX_RANGE_DAYS = 366;
/** attendance_days refuses a longer range (migration 0023). */
export const ATTENDANCE_MAX_DAYS = 62;

export const REPORTS: Record<ReportKey, Meta> = {
  pipeline: {
    title: "Pipeline and forecast",
    description: "Open and won deals expected to close in the dates chosen, with what each is worth by probability.",
    area: "sales",
    maxDays: MAX_RANGE_DAYS,
  },
  institutions: {
    title: "Institutions by stage",
    description: "How many institutions are at each stage today, and how many were added in the dates chosen.",
    area: "institutions",
    maxDays: MAX_RANGE_DAYS,
  },
  timeliness: {
    title: "Task timeliness",
    description: "Tasks finished in the dates chosen, early, on time or late, for each person, and what is still open.",
    area: "tasks",
    maxDays: MAX_RANGE_DAYS,
  },
  time: {
    title: "Time logged",
    description: "Hours logged on each task by each person in the dates chosen.",
    area: "timesheet",
    maxDays: MAX_RANGE_DAYS,
  },
  attendance: {
    title: "Attendance summary",
    description: "Days present, late, left early, missed check-outs and hours for each person who checks in.",
    area: "attendance",
    maxDays: ATTENDANCE_MAX_DAYS,
  },
  leave: {
    title: "Leave summary",
    description: "Leave that falls in the dates chosen, with the days taken and where each request stands.",
    area: "hr",
    maxDays: MAX_RANGE_DAYS,
  },
};

const isLead = (me: Me): boolean => me.role === "founder" || me.role === "dept_lead";

/** Who may run each report. The database still limits the rows; this only hides what a person could not use. */
export function canRunReport(me: Me | null, key: ReportKey): boolean {
  if (!me || !canAccess(me, "reports")) return false;
  switch (key) {
    case "pipeline":
      return isLead(me) && canAccess(me, "sales");
    case "institutions":
      return isLead(me) && canAccess(me, "institutions");
    case "timeliness":
    case "time":
      return isLead(me);
    case "attendance":
    case "leave":
      return canSeeTeamAttendance(me) || isHr(me);
  }
}

export const reportsFor = (me: Me | null): ReportKey[] => REPORT_KEYS.filter((k) => canRunReport(me, k));

// ---------------------------------------------------------------- the date range

export type DateRange = { from: string; to: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (s: string): boolean => YMD.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The month containing `today`. */
export function thisMonth(today: string): DateRange {
  const b = monthBounds(today.slice(0, 7));
  return { from: b.first, to: b.last };
}

export function lastMonth(today: string): DateRange {
  const b = monthBounds(addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7));
  return { from: b.first, to: b.last };
}

/** The dates from the address bar. A missing or unreal date falls back to this month; a backwards range is turned round; a long one is cut to `maxDays`. */
export function parseRange(
  raw: { from?: string | string[]; to?: string | string[] },
  today: string,
  maxDays: number = MAX_RANGE_DAYS,
): DateRange & { cut: boolean } {
  const def = thisMonth(today);
  const f = first(raw.from);
  const t = first(raw.to);
  let from = f && isRealDay(f) ? f : def.from;
  let to = t && isRealDay(t) ? t : def.to;
  if (to < from) [from, to] = [to, from];
  const limit = addDays(from, maxDays - 1);
  if (to > limit) return { from, to: limit, cut: true };
  return { from, to, cut: false };
}

export function presetRanges(today: string): { label: string; range: DateRange }[] {
  return [
    { label: "This month", range: thisMonth(today) },
    { label: "Last month", range: lastMonth(today) },
    { label: "Last 30 days", range: { from: addDays(today, -29), to: today } },
  ];
}

// ---------------------------------------------------------------- the table

export type CellType = "text" | "date" | "inr" | "number" | "percent";
export type Cell = string | number | null;
export type Column = { label: string; type?: CellType };
export type ReportTable = {
  key: ReportKey;
  title: string;
  range: DateRange;
  columns: Column[];
  rows: Cell[][];
  /** A closing line, shown under the rows and written as the last CSV line. */
  totals: Cell[] | null;
  notes: string[];
};

export function reportFilename(key: ReportKey, range: DateRange): string {
  return `${key}-${range.from}-to-${range.to}.csv`;
}

export function tableToCsv(t: ReportTable): string {
  return toCsv(t.columns.map((c) => c.label), t.totals ? [...t.rows, t.totals] : t.rows);
}

const round = (n: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const byText = (a: string, b: string): number => a.localeCompare(b, "en", { sensitivity: "base" });
const inRange = (day: string | null | undefined, r: DateRange): boolean => !!day && day >= r.from && day <= r.to;

function base(key: ReportKey, range: DateRange, columns: Column[], rows: Cell[][], totals: Cell[] | null, notes: string[] = []): ReportTable {
  return { key, title: REPORTS[key].title, range, columns, rows, totals, notes };
}

// ---------------------------------------------------------------- pipeline and forecast

export type DealInput = {
  title: string;
  stage: string;
  value_inr: number | string | null;
  probability: number | null;
  expected_close: string | null;
  institution: { name: string } | null;
  owner: { full_name: string } | null;
};

const dealLabel = (stage: string): string => DEAL_STAGE_LABELS[stage as DealStage] ?? stage;

/** What a deal is worth by chance: a won deal in full, a lost one not at all, an open one by its probability (the stage's usual one when none is set). */
export function weightedValue(d: Pick<DealInput, "stage" | "value_inr" | "probability">): number {
  const value = Number(d.value_inr ?? 0);
  if (d.stage === "won") return round(value, 2);
  if (d.stage === "lost") return 0;
  const p = d.probability ?? STAGE_PROBABILITY[d.stage as DealStage] ?? 0;
  return round((value * p) / 100, 2);
}

export function pipelineReport(deals: DealInput[], range: DateRange, notes: string[] = []): ReportTable {
  const open = deals
    .filter((d) => d.stage !== "lost" && inRange(d.expected_close, range))
    .sort((a, b) => (a.expected_close ?? "").localeCompare(b.expected_close ?? "") || byText(a.title, b.title));
  const rows: Cell[][] = open.map((d) => [
    d.institution?.name ?? "",
    d.title,
    dealLabel(d.stage),
    d.owner?.full_name ?? "",
    d.expected_close,
    Number(d.value_inr ?? 0),
    d.probability ?? (d.stage === "won" ? 100 : null),
    weightedValue(d),
  ]);
  const totals: Cell[] | null = open.length
    ? ["Total", `${open.length} deal${open.length === 1 ? "" : "s"}`, null, null, null, round(sum(open.map((d) => Number(d.value_inr ?? 0))), 2), null, round(sum(open.map(weightedValue)), 2)]
    : null;
  return base(
    "pipeline",
    range,
    [
      { label: "Institution" },
      { label: "Deal" },
      { label: "Stage" },
      { label: "Owner" },
      { label: "Expected close", type: "date" },
      { label: "Value", type: "inr" },
      { label: "Chance", type: "percent" },
      { label: "Weighted value", type: "inr" },
    ],
    rows,
    totals,
    ["Lost deals and archived deals are left out. Deals with no expected close date are not in any date range.", ...notes],
  );
}

// ---------------------------------------------------------------- institutions by stage

export type InstitutionInput = { stage: string; created_at: string };

export function institutionsReport(rows: InstitutionInput[], range: DateRange, notes: string[] = []): ReportTable {
  const total = new Map<string, number>();
  const added = new Map<string, number>();
  for (const r of rows) {
    total.set(r.stage, (total.get(r.stage) ?? 0) + 1);
    if (inRange(todayIST(new Date(r.created_at)), range)) added.set(r.stage, (added.get(r.stage) ?? 0) + 1);
  }
  const out: Cell[][] = STAGES.map((s) => [STAGE_LABELS[s], total.get(s) ?? 0, added.get(s) ?? 0]);
  return base(
    "institutions",
    range,
    [{ label: "Stage" }, { label: "Institutions now", type: "number" }, { label: "Added in these dates", type: "number" }],
    out,
    ["Total", sum([...total.values()]), sum([...added.values()])],
    ["Archived institutions are left out. The first column is a count as of now, whatever dates are chosen.", ...notes],
  );
}

// ---------------------------------------------------------------- task timeliness

export function timelinessReport(tasks: TaskRow[], names: Map<string, string>, range: DateRange, today: string, notes: string[] = []): ReportTable {
  type Acc = { done: number; early: number; onTime: number; late: number; lateDays: number[]; open: number; overdue: number };
  const by = new Map<string, Acc>();
  const acc = (id: string | null): Acc => {
    const k = id ?? "";
    let a = by.get(k);
    if (!a) by.set(k, (a = { done: 0, early: 0, onTime: 0, late: 0, lateDays: [], open: 0, overdue: 0 }));
    return a;
  };
  for (const t of tasks) {
    if (t.status === "done" && inRange(t.done_day, range) && t.bucket) {
      const a = acc(t.assignee_id);
      a.done += 1;
      if (t.bucket === "early") a.early += 1;
      else if (t.bucket === "on_time") a.onTime += 1;
      else {
        a.late += 1;
        a.lateDays.push(t.days_late ?? 0);
      }
    } else if (isOpen(t)) {
      const a = acc(t.assignee_id);
      a.open += 1;
      if (t.due_date && t.due_date < today) a.overdue += 1;
    }
  }
  const pct = (a: { done: number; early: number; onTime: number }): number | null => (a.done ? round(((a.early + a.onTime) / a.done) * 100, 1) : null);
  const label = (id: string): string => (id ? names.get(id) ?? "Someone no longer here" : "Not assigned");
  const entries = [...by.entries()].sort(([ia, a], [ib, b]) => b.done - a.done || byText(label(ia), label(ib)));
  const rows: Cell[][] = entries.map(([id, a]) => [
    label(id), a.done, a.early, a.onTime, a.late, pct(a), a.lateDays.length ? round(sum(a.lateDays) / a.lateDays.length, 1) : null, a.open, a.overdue,
  ]);
  const all = entries.map(([, a]) => a);
  const done = sum(all.map((a) => a.done));
  const early = sum(all.map((a) => a.early));
  const onTime = sum(all.map((a) => a.onTime));
  const lateDays = all.flatMap((a) => a.lateDays);
  const totals: Cell[] | null = rows.length
    ? ["Total", done, early, onTime, sum(all.map((a) => a.late)), pct({ done, early, onTime }), lateDays.length ? round(sum(lateDays) / lateDays.length, 1) : null, sum(all.map((a) => a.open)), sum(all.map((a) => a.overdue))]
    : null;
  return base(
    "timeliness",
    range,
    [
      { label: "Person" },
      { label: "Finished", type: "number" },
      { label: "Early", type: "number" },
      { label: "On time", type: "number" },
      { label: "Late", type: "number" },
      { label: "On time or early", type: "percent" },
      { label: "Average days late", type: "number" },
      { label: "Open now", type: "number" },
      { label: "Overdue now", type: "number" },
    ],
    rows,
    totals,
    ["Open now and Overdue now are as of today, whatever dates are chosen.", ...notes],
  );
}

// ---------------------------------------------------------------- time logged

export type TimeInput = {
  staff_id: string;
  task_id: string;
  minutes: number | null;
  staff: { full_name: string } | null;
  task: { title: string } | null;
};

export function timeReport(entries: TimeInput[], range: DateRange, notes: string[] = []): ReportTable {
  const by = new Map<string, { person: string; task: string; count: number; minutes: number }>();
  for (const e of entries) {
    if (e.minutes === null) continue;
    const k = `${e.staff_id}|${e.task_id}`;
    const row = by.get(k) ?? { person: e.staff?.full_name ?? "Someone no longer here", task: e.task?.title ?? "A removed task", count: 0, minutes: 0 };
    row.count += 1;
    row.minutes += e.minutes;
    by.set(k, row);
  }
  const list = [...by.values()].sort((a, b) => byText(a.person, b.person) || b.minutes - a.minutes || byText(a.task, b.task));
  return base(
    "time",
    range,
    [{ label: "Person" }, { label: "Task" }, { label: "Entries", type: "number" }, { label: "Hours", type: "number" }],
    list.map((r) => [r.person, r.task, r.count, round(r.minutes / 60, 2)]),
    list.length ? ["Total", null, sum(list.map((r) => r.count)), round(sum(list.map((r) => r.minutes)) / 60, 2)] : null,
    ["A timer that is still running is not counted until it is stopped.", ...notes],
  );
}

// ---------------------------------------------------------------- attendance

export function attendanceReport(
  days: DayRow[],
  names: Map<string, string>,
  settings: OfficeSettings,
  today: string,
  nowMinutes: number,
  range: DateRange,
  notes: string[] = [],
): ReportTable {
  const by = new Map<string, DayRow[]>();
  for (const d of days) by.set(d.staff_id, [...(by.get(d.staff_id) ?? []), d]);
  const list = [...by.entries()]
    .map(([id, rows]) => {
      const s = summarise(rows, settings, today, nowMinutes);
      const leave = rows.filter((r) => dayStatus(r, settings, today, nowMinutes).kind === "leave").length;
      return { name: names.get(id) ?? "Someone no longer here", ...s, leave };
    })
    .sort((a, b) => byText(a.name, b.name));
  const cells = (r: (typeof list)[number]): Cell[] => [r.name, r.present, r.late, r.early, r.missing, r.absent, r.leave, round(r.minutes / 60, 2)];
  const out: string[] = [...notes];
  if (!settings.flags_on) out.push("Late, left early and absent are not counted until the founder switches attendance flags on.");
  return base(
    "attendance",
    range,
    [
      { label: "Person" },
      { label: "Days present", type: "number" },
      { label: "Late", type: "number" },
      { label: "Left early", type: "number" },
      { label: "No check-out", type: "number" },
      { label: "Absent", type: "number" },
      { label: "On leave", type: "number" },
      { label: "Hours", type: "number" },
    ],
    list.map(cells),
    list.length
      ? ["Total", sum(list.map((r) => r.present)), sum(list.map((r) => r.late)), sum(list.map((r) => r.early)), sum(list.map((r) => r.missing)), sum(list.map((r) => r.absent)), sum(list.map((r) => r.leave)), round(sum(list.map((r) => r.minutes)) / 60, 2)]
      : null,
    out,
  );
}

// ---------------------------------------------------------------- leave

export type LeaveInput = {
  from_date: string;
  to_date: string;
  days: number | string;
  state: string;
  staff: { full_name: string } | null;
  type: { name: string } | null;
};

export const LEAVE_STATE_LABELS: Record<string, string> = { pending: "Waiting", approved: "Approved", rejected: "Declined", cancelled: "Cancelled" };

export function leaveReport(requests: LeaveInput[], range: DateRange, notes: string[] = []): ReportTable {
  const list = requests
    .filter((r) => r.from_date <= range.to && r.to_date >= range.from)
    .sort((a, b) => a.from_date.localeCompare(b.from_date) || byText(a.staff?.full_name ?? "", b.staff?.full_name ?? ""));
  const approved = sum(list.filter((r) => r.state === "approved").map((r) => Number(r.days)));
  return base(
    "leave",
    range,
    [
      { label: "Person" },
      { label: "Leave" },
      { label: "From", type: "date" },
      { label: "To", type: "date" },
      { label: "Days", type: "number" },
      { label: "Status" },
    ],
    list.map((r) => [r.staff?.full_name ?? "Someone no longer here", r.type?.name ?? "Leave", r.from_date, r.to_date, Number(r.days), LEAVE_STATE_LABELS[r.state] ?? r.state]),
    list.length ? ["Approved days", null, null, null, round(approved, 2), null] : null,
    ["Days are the whole request, even when it starts before or runs past the dates chosen.", ...notes],
  );
}
