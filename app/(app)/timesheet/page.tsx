import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { canTrackTime } from "@/lib/permissions";
import { listOwners } from "@/lib/queries/institution";
import { getRunningTimer, listEntriesBetween } from "@/lib/queries/time";
import { mineOr, ownedTaskIds } from "@/lib/queries/tasks";
import { parseWeek, TIME_EDIT_DAYS, weekDays } from "@/lib/schemas/time";
import { addDays } from "@/lib/task-layout";
import { createClient } from "@/utils/supabase/server";
import { PersonPicker } from "./person-picker";
import { TimesheetGrid, type GridDay, type GridRow } from "./timesheet-grid";

export const metadata: Metadata = { title: "Timesheet" };

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric" });
const TASK_PICKER_LIMIT = 150;

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ week?: string; person?: string }> }) {
  const { me, allowed } = await requireArea("timesheet");
  const crumbs = [{ label: "Timesheet" }];
  if (!allowed) return <><PageHeader title="Timesheet" crumbs={crumbs} /><AccessDenied what="the timesheet" /></>;

  const sp = await searchParams;
  const today = todayIST();
  const start = parseWeek(sp.week, today);
  const end = addDays(start, 6);
  const supabase = await createClient();

  const canPick = me.role === "founder" || me.role === "dept_lead";
  const owners = canPick ? await listOwners(supabase) : null;
  const people = (owners?.data ?? []).filter((o) => o.role !== "partner" && o.role !== "viewer").map((o) => ({ id: o.id, full_name: o.full_name }));
  const asked = z.uuid().safeParse(sp.person);
  const viewId = canPick && asked.success && people.some((p) => p.id === asked.data) ? asked.data : me.id;
  const own = viewId === me.id;
  const readOnly = !own || !canTrackTime(me);
  const editFrom = addDays(today, -TIME_EDIT_DAYS);

  const owned = readOnly ? [] : await ownedTaskIds(supabase, me.id);
  const [entries, running, pickable] = await Promise.all([
    listEntriesBetween(supabase, viewId, start, end),
    own && canTrackTime(me) ? getRunningTimer(supabase, me.id) : Promise.resolve({ data: null }),
    readOnly
      ? Promise.resolve({ data: [] as { id: string; title: string }[] })
      : supabase
          .from("task")
          .select("id, title")
          .or(mineOr(me.id, owned))
          .or(`status.in.(todo,doing,blocked),updated_at.gte.${new Date(`${addDays(today, -14)}T00:00:00+05:30`).toISOString()}`)
          .order("updated_at", { ascending: false })
          .limit(TASK_PICKER_LIMIT),
  ]);

  const week = `${formatDate(start)} to ${formatDate(end)}`;
  const header = (
    <PageHeader
      title="Timesheet"
      crumbs={crumbs}
      description={`Time spent on tasks, week of ${week}. Times are in India time.`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canPick && people.length > 1 && <PersonPicker week={start} current={viewId} meId={me.id} people={people} />}
          <WeekLinks start={start} person={own ? null : viewId} />
        </div>
      }
    />
  );
  if (entries.error) return <>{header}<LoadError what="the timesheet" /></>;

  const byTask = new Map<string, GridRow>();
  for (const e of entries.data ?? []) {
    if (e.minutes === null) continue;
    const row = byTask.get(e.task_id) ?? { taskId: e.task_id, title: e.task?.title ?? "Task", entries: [] };
    row.entries.push({ id: e.id, workDate: e.work_date, minutes: e.minutes, note: e.note, timed: e.source === "timer", editable: !readOnly && e.work_date >= editFrom });
    byTask.set(e.task_id, row);
  }
  const rows = [...byTask.values()].sort((a, b) => a.title.localeCompare(b.title));
  const days: GridDay[] = weekDays(start).map((d) => ({ date: d, label: dayFmt.format(new Date(`${d}T00:00:00Z`)), future: d > today, today: d === today }));

  const picker = new Map((pickable.data ?? []).map((t) => [t.id, t.title]));
  const taskOptions = [...picker].map(([id, title]) => ({ id, title }));

  return (
    <>
      {header}
      {running.data && (
        <p className="text-muted-foreground mb-4 text-sm">
          A timer is running on <Link className="underline-offset-4 hover:underline" href={`/tasks/${running.data.task_id}`}>{running.data.task?.title ?? "a task"}</Link>. It is added here when you stop it.
        </p>
      )}
      {!own && <p className="text-muted-foreground mb-4 text-sm">You are looking at a teammate&apos;s week. It is read-only.</p>}
      <TimesheetGrid rows={rows} days={days} taskOptions={taskOptions} today={today} readOnly={readOnly} />
    </>
  );
}

function WeekLinks({ start, person }: { start: string; person: string | null }) {
  const href = (week: string | null) => {
    const q = new URLSearchParams();
    if (week) q.set("week", week);
    if (person) q.set("person", person);
    const s = q.toString();
    return s ? `/timesheet?${s}` : "/timesheet";
  };
  return (
    <nav className="flex gap-2" aria-label="Week">
      <Button asChild variant="outline" size="sm"><Link href={href(addDays(start, -7))}>Previous week</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href={href(null)}>This week</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href={href(addDays(start, 7))}>Next week</Link></Button>
    </nav>
  );
}
