import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClockIcon, CalendarCheck2Icon, CalendarClockIcon, CalendarRangeIcon, CircleAlertIcon, CircleDashedIcon, InboxIcon,
  ListTodoIcon, TimerIcon, TriangleAlertIcon, type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { AttendanceToday } from "@/components/attendance-today";
import { Chip, DepartmentChip, HealthChip, PriorityChip, TaskStatusChip } from "@/components/chips";
import { HealthBar } from "@/components/health-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Elapsed } from "@/components/timer-chip";
import { PageHeader } from "@/components/page-header";
import { LoadError } from "@/components/load-error";
import { TaskStatusButton } from "@/components/task-status-button";
import { requireMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { canAccess, canCheckIn, canTrackTime, canUpdateTask, type Department, type Me } from "@/lib/permissions";
import { listScheduleBetween } from "@/lib/queries/calendar";
import { dayStartIso, formatTimeRange } from "@/lib/schemas/calendar";
import { MEETING_KIND_TONE } from "@/lib/tone";
import { getRunningTimer, listEntriesBetween } from "@/lib/queries/time";
import { formatMinutes, formatSpan } from "@/lib/schemas/task";
import { onTimeRate, summarizeHealth, taskHealth } from "@/lib/task-health";
import { listRecentlyDone, ON_TIME_DAYS } from "@/lib/queries/tasks";
import { elapsedMinutes, formatHM, weekStart } from "@/lib/schemas/time";
import { addDays } from "@/lib/task-layout";
import { PRIORITY_TONE, TONE_PANEL, TONE_STRIPE, TONE_TEXT, type Tone } from "@/lib/tone";
import { DAY_BUCKET_LABELS, DAY_BUCKETS, groupTasks, type DayBucket } from "@/lib/workload";
import { createClient } from "@/utils/supabase/server";
import { StatCard, WeekBars } from "./my-day-widgets";
import { TaskTimerButton } from "./task-timer-button";

export const metadata: Metadata = { title: "My day" };

const LIMIT = 200;

const BUCKET_STYLE: Record<DayBucket, { icon: LucideIcon; tone: Tone }> = {
  overdue: { icon: CircleAlertIcon, tone: "red" },
  today: { icon: CalendarCheck2Icon, tone: "amber" },
  soon: { icon: CalendarRangeIcon, tone: "blue" },
  later: { icon: CalendarClockIcon, tone: "slate" },
  unscheduled: { icon: CircleDashedIcon, tone: "slate" },
};

const longDay = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });

type Row = {
  id: string; title: string; department: Department | null; status: string; priority: number;
  start_date: string | null; due_date: string | null; due_time: string | null; estimate_minutes: number | null; assignee_id: string | null;
  accepted_at: string | null; updated_at: string;
};

export default async function MyDayPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const today = todayIST();
  const week = weekStart(today);
  const tracking = canTrackTime(me);

  const showMeetings = canAccess(me, "calendar");
  const [meetingsToday, tasksRes, timerRes, entriesRes, doneRes] = await Promise.all([
    showMeetings ? listScheduleBetween(supabase, me, dayStartIso(today), dayStartIso(addDays(today, 1))) : Promise.resolve([]),
    supabase
      .from("task")
      .select("id, title, department, status, priority, start_date, due_date, due_time, estimate_minutes, assignee_id, accepted_at, updated_at", { count: "exact" })
      .eq("assignee_id", me.id)
      .in("status", ["todo", "doing", "blocked"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: true })
      .range(0, LIMIT - 1),
    tracking ? getRunningTimer(supabase, me.id) : Promise.resolve({ data: null, error: null }),
    tracking ? listEntriesBetween(supabase, me.id, week, addDays(week, 6)) : Promise.resolve({ data: [], error: null }),
    listRecentlyDone(supabase, me.id),
  ]);

  const { data: tasks, error, count } = tasksRes;
  const running = timerRes.data;
  const minutesByDay: Record<string, number> = {};
  for (const e of entriesRes.data ?? []) minutesByDay[e.work_date] = (minutesByDay[e.work_date] ?? 0) + (e.minutes ?? 0);
  const runningNow = running?.started_at ? elapsedMinutes(running.started_at) : 0;
  const trackedToday = (minutesByDay[today] ?? 0) + runningNow;
  if (runningNow) minutesByDay[today] = trackedToday;
  const groups = groupTasks(tasks ?? [], today);
  const planned = [...groups.overdue, ...groups.today].reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0);
  const next = (tasks ?? []).find((t) => t.status === "doing") ?? groups.overdue[0] ?? groups.today[0] ?? groups.soon[0] ?? null;
  const health = summarizeHealth(tasks ?? []);
  const onTime = onTimeRate(doneRes.data ?? []);

  return (
    <>
      <PageHeader title={`Hello, ${me.full_name.split(" ")[0]}`} description={`${longDay.format(new Date())}. What is late, what is due and what is coming.`} />

      {error ? (
        <LoadError what="your tasks" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard
                icon={CircleAlertIcon}
                tone={groups.overdue.length ? "red" : "green"}
                label="Overdue"
                value={groups.overdue.length}
                hint={groups.overdue.length ? "Needs you first" : "All caught up"}
              />
              <StatCard icon={AlarmClockIcon} tone={groups.today.length ? "amber" : "slate"} label="Due today" value={groups.today.length} hint={planned ? `${formatMinutes(planned)} planned` : "Nothing estimated"} />
              {tracking ? (
                <StatCard icon={TimerIcon} tone="blue" label="Tracked today" value={formatHM(trackedToday)} hint={<Link className="underline-offset-4 hover:underline" href="/timesheet">Open timesheet</Link>} />
              ) : (
                <StatCard icon={CalendarRangeIcon} tone="blue" label="Coming up" value={groups.soon.length} hint="This week" />
              )}
              <StatCard icon={ListTodoIcon} tone="violet" label="Open tasks" value={count ?? tasks?.length ?? 0} hint="Assigned to you" />
            </div>

            {health.total > 0 && (
              <Card>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <TriangleAlertIcon aria-hidden className={cn("size-4", health.attention ? TONE_TEXT.orange : TONE_TEXT.green)} />
                      {health.attention
                        ? `${health.attention} ${health.attention === 1 ? "task needs" : "tasks need"} attention`
                        : "Your tasks are on track"}
                    </h2>
                    {onTime.rate !== null && (
                      <span className="text-muted-foreground text-xs" title={`${onTime.onTime} of ${onTime.total} tasks finished on or before the deadline, last ${ON_TIME_DAYS} days`}>
                        <span className={cn("font-semibold tabular-nums", onTime.rate >= 80 ? TONE_TEXT.green : onTime.rate >= 50 ? TONE_TEXT.amber : TONE_TEXT.red)}>{onTime.rate}%</span> on time, last {ON_TIME_DAYS} days
                      </span>
                    )}
                  </div>
                  <HealthBar summary={health} legend />
                </CardContent>
              </Card>
            )}

            {meetingsToday.length > 0 && (
              <section className="space-y-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarRangeIcon aria-hidden className={cn("size-4", TONE_TEXT.violet)} />
                  Meetings and workshops today
                  <span className="text-muted-foreground font-normal tabular-nums">{meetingsToday.length}</span>
                </h2>
                <ul className="space-y-2" aria-label="Meetings and workshops today">
                  {meetingsToday.map((m) => (
                    <li key={m.key}>
                      <Link
                        href={m.href}
                        className={cn("bg-card hover:bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-l-4 px-3 py-2 text-sm", TONE_STRIPE[m.source === "event" ? "orange" : (MEETING_KIND_TONE[m.kind] ?? "slate")])}
                      >
                        <span className="text-muted-foreground w-36 shrink-0 tabular-nums">{formatTimeRange(m.starts_at, m.ends_at)}</span>
                        <span className="font-medium">{m.title}</span>
                        {m.role && <Chip tone="orange">{m.role}</Chip>}
                        {m.pending && <Chip tone="amber">Waiting for an answer</Chip>}
                        {m.needsMe && <Chip tone="violet">Needs your answer</Chip>}
                        {m.place && <span className="text-muted-foreground">{m.place}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!tasks?.length ? (
              <Card>
                <CardContent>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><InboxIcon aria-hidden /></EmptyMedia>
                      <EmptyTitle>Nothing assigned to you</EmptyTitle>
                      <EmptyDescription>Follow-ups from your activities and tasks from deals and events will appear here.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </CardContent>
              </Card>
            ) : (
              <>
                <NowCard me={me} tracking={tracking} running={running} next={next} />
                {count !== null && count > LIMIT && (
                  <p className="text-muted-foreground text-sm">Showing the first {LIMIT} of {count} open tasks, soonest due first.</p>
                )}
                {DAY_BUCKETS.filter((b) => groups[b].length > 0).map((b) => {
                  const { icon: Icon, tone } = BUCKET_STYLE[b];
                  return (
                    <section key={b} className="space-y-2">
                      <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <Icon aria-hidden className={cn("size-4", TONE_TEXT[tone])} />
                        {DAY_BUCKET_LABELS[b]}
                        <span className="text-muted-foreground font-normal tabular-nums">{groups[b].length}</span>
                      </h2>
                      <ul className="space-y-2" aria-label={DAY_BUCKET_LABELS[b]}>
                        {groups[b].map((t) => (
                          <TaskRow key={t.id} t={t} me={me} tracking={tracking} runningId={running?.task_id === t.id ? running.id : null} showDue={b !== "unscheduled"} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </>
            )}
          </div>

          <aside className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
            {canCheckIn(me) && (
              <Suspense fallback={null}>
                <AttendanceToday me={me} />
              </Suspense>
            )}
            {tracking && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><TimerIcon aria-hidden className={cn("size-4", TONE_TEXT.blue)} /> This week</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <WeekBars weekStart={week} today={today} minutesByDay={minutesByDay} />
                  </CardContent>
                </Card>
              </>
            )}
            <p className="text-muted-foreground text-xs">
              Tasks for your whole department are in <Link className="underline" href="/tasks">Tasks</Link>.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}

type RunningTimerRow = NonNullable<Awaited<ReturnType<typeof getRunningTimer>>["data"]>;

/** The one thing to look at: the timer that is running, or the task to start next. */
function NowCard({ me, tracking, running, next }: { me: Me; tracking: boolean; running: RunningTimerRow | null; next: Row | null }) {
  if (running?.task && running.started_at) {
    return (
      <Card className={cn("border-0 ring-1 ring-blue-200 dark:ring-blue-900", TONE_PANEL.blue)}>
        <CardContent className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-300">
              <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-blue-500" /></span>
              Working on now
            </div>
            <Link className="block truncate text-lg font-semibold underline-offset-4 hover:underline" href={`/tasks/${running.task.id}`}>{running.task.title}</Link>
            <div className="text-muted-foreground text-sm">Running for <span className="text-foreground font-medium tabular-nums"><Elapsed startedAt={running.started_at} /></span></div>
          </div>
          <TaskTimerButton taskId={running.task.id} title={running.task.title} runningId={running.id} />
        </CardContent>
      </Card>
    );
  }
  if (!next) return null;
  return (
    <Card className={cn("border-0 ring-1 ring-black/5 dark:ring-white/10", TONE_PANEL.slate)}>
      <CardContent className="flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-muted-foreground text-xs font-medium">{next.status === "doing" ? "In progress" : "Up next"}</div>
          <Link className="block truncate text-lg font-semibold underline-offset-4 hover:underline" href={`/tasks/${next.id}`}>{next.title}</Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityChip priority={next.priority} />
            <DepartmentChip department={next.department} />
            {next.due_date && <DueInfo t={next} />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tracking && <TaskTimerButton taskId={next.id} title={next.title} runningId={null} />}
          {canUpdateTask(me, next) && <TaskStatusButton id={next.id} title={next.title} />}
        </div>
      </CardContent>
    </Card>
  );
}

function DueInfo({ t }: { t: Row }) {
  const h = taskHealth(t);
  return (
    <>
      <HealthChip health={h} />
      {h.key !== "no_date" && <span className="text-muted-foreground text-xs">{formatSpan(t.start_date, t.due_date, t.due_time)}</span>}
    </>
  );
}

function TaskRow({ t, me, tracking, runningId, showDue }: { t: Row; me: Me; tracking: boolean; runningId: string | null; showDue: boolean }) {
  const health = taskHealth(t);
  const tone = health.level > 0 ? health.tone : (PRIORITY_TONE[t.priority] ?? "slate");
  return (
    <li className={cn("bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border border-l-4 px-3 py-2.5 shadow-xs", TONE_STRIPE[tone])}>
      <div className="min-w-0 space-y-1.5">
        <Link className="block truncate text-sm font-medium underline-offset-4 hover:underline" href={`/tasks/${t.id}`}>{t.title}</Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityChip priority={t.priority} />
          <DepartmentChip department={t.department} />
          {showDue && <DueInfo t={t} />}
          {(t.status === "doing" || t.status === "blocked") && <TaskStatusChip status={t.status} />}
          {t.estimate_minutes ? <span className="text-muted-foreground text-xs">Estimate {formatMinutes(t.estimate_minutes)}</span> : null}
          {runningId && <Chip tone="green" icon={TimerIcon}>Timer running</Chip>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {tracking && <TaskTimerButton taskId={t.id} title={t.title} runningId={runningId} />}
        {canUpdateTask(me, t) && <TaskStatusButton id={t.id} title={t.title} />}
      </div>
    </li>
  );
}
