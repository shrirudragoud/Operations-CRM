import "server-only";
import { istMinutes } from "@/lib/attendance";
import { todayIST } from "@/lib/format";
import { normalizeRows, type RawTaskRow } from "@/lib/ops-insight";
import type { Me } from "@/lib/permissions";
import { ATTENDANCE_MAX_DAYS, attendanceReport, canRunReport, institutionsReport, leaveReport, pipelineReport, timeReport, timelinessReport } from "@/lib/reports";
import type { DateRange, DealInput, InstitutionInput, LeaveInput, ReportKey, ReportTable, TimeInput } from "@/lib/reports";
import { addDays } from "@/lib/task-layout";
import { getDays, getOfficeSettings, listTagged } from "@/lib/queries/attendance";
import { getPeople, getTimelinessRows, TIMELINESS_LIMIT } from "@/lib/queries/cockpit";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Rows a report reads before it says the list was cut. */
const ROW_LIMIT = 5000;

export type ReportResult = { ok: true; table: ReportTable } | { ok: false; error: string };

const failed = (what: string): ReportResult => ({ ok: false, error: `Could not load ${what}.` });
const capped = (n: number, what: string): string[] => (n >= ROW_LIMIT ? [`Only the first ${ROW_LIMIT} ${what} are counted. Choose fewer dates for the full picture.`] : []);

/**
 * Run one report as the signed-in person. Every read goes through their own session, so row-level security decides what is
 * counted; nothing here uses a service key. A scheduled job can call this with a Supabase client for the person the report is
 * for (never a client that skips row-level security) and send the table with `tableToCsv`.
 */
export async function runReport(supabase: Supabase, me: Me, key: ReportKey, range: DateRange, today: string = todayIST()): Promise<ReportResult> {
  if (!canRunReport(me, key)) return { ok: false, error: "You do not have access to this report." };
  switch (key) {
    case "pipeline": {
      const { data, error } = await supabase
        .from("deal")
        .select("title, stage, value_inr, probability, expected_close, institution:institution!deal_institution_id_fkey(name), owner:staff!deal_owner_id_fkey(full_name)")
        .is("archived_at", null)
        .neq("stage", "lost")
        .gte("expected_close", range.from)
        .lte("expected_close", range.to)
        .order("expected_close")
        .limit(ROW_LIMIT);
      if (error) return failed("the deals");
      const rows = (data ?? []) as unknown as DealInput[];
      return { ok: true, table: pipelineReport(rows, range, capped(rows.length, "deals")) };
    }
    case "institutions": {
      const { data, error } = await supabase.from("institution").select("stage, created_at").is("archived_at", null).limit(ROW_LIMIT);
      if (error) return failed("the institutions");
      const rows = (data ?? []) as InstitutionInput[];
      return { ok: true, table: institutionsReport(rows, range, capped(rows.length, "institutions")) };
    }
    case "timeliness": {
      const [rows, people] = await Promise.all([getTimelinessRows(supabase, range.from), getPeople(supabase)]);
      if (rows.error || people.error) return failed("the tasks");
      const tasks = normalizeRows((rows.data ?? []) as RawTaskRow[]);
      const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
      const notes = (rows.data ?? []).length >= TIMELINESS_LIMIT ? [`Only the first ${TIMELINESS_LIMIT} tasks are counted. Choose fewer dates for the full picture.`] : [];
      return { ok: true, table: timelinessReport(tasks, names, range, today, notes) };
    }
    case "time": {
      const { data, error } = await supabase
        .from("time_entry")
        .select("staff_id, task_id, minutes, staff:staff!time_entry_staff_id_fkey(full_name), task:task!time_entry_task_id_fkey(title)")
        .gte("work_date", range.from)
        .lte("work_date", range.to)
        .not("minutes", "is", null)
        .limit(ROW_LIMIT);
      if (error) return failed("the time entries");
      const rows = (data ?? []) as unknown as TimeInput[];
      return { ok: true, table: timeReport(rows, range, capped(rows.length, "time entries")) };
    }
    case "attendance": {
      const to = range.to > addDays(range.from, ATTENDANCE_MAX_DAYS - 1) ? addDays(range.from, ATTENDANCE_MAX_DAYS - 1) : range.to;
      const [settings, days, tagged] = await Promise.all([getOfficeSettings(supabase), getDays(supabase, range.from, to), listTagged(supabase)]);
      if (!settings.data || days.error || tagged.error) return failed("attendance");
      const names = new Map((tagged.data ?? []).map((p) => [p.id, p.full_name]));
      const notes = to !== range.to ? [`Attendance can be summed for at most ${ATTENDANCE_MAX_DAYS} days, so this stops on ${to}.`] : [];
      return { ok: true, table: attendanceReport(days.data, names, settings.data, today, istMinutes(new Date()), { from: range.from, to }, notes) };
    }
    case "leave": {
      const { data, error } = await supabase
        .from("leave_request")
        .select("from_date, to_date, days, state, staff:staff!leave_request_staff_id_fkey(full_name), type:leave_type!leave_request_leave_type_id_fkey(name)")
        .lte("from_date", range.to)
        .gte("to_date", range.from)
        .order("from_date")
        .limit(ROW_LIMIT);
      if (error) return failed("the leave requests");
      const rows = (data ?? []) as unknown as LeaveInput[];
      return { ok: true, table: leaveReport(rows, range, capped(rows.length, "leave requests")) };
    }
  }
}
