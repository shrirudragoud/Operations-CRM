import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { LoadError } from "@/components/load-error";
import { BacklogChart, BandChart, DoneChart, PlanChart, WeekdayChart } from "@/components/ops-charts";
import { CalendarHeatmap, PeopleHeatmap } from "@/components/ops-heatmaps";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayIST } from "@/lib/format";
import {
  PERIODS, PERIOD_LABELS, backlogSeries, dailySeries, delta, formatPercent, heatmap, inScope, isOpen, lastWeeks, latenessBands, normalizeRows, overdueAge,
  peopleByWeek, peopleTable, periodRange, planVsActual, shiftPeriod, summarize, weekLines, weekdayProfile,
  type BacklogRow, type Delta, type InsightParams, type Scope,
} from "@/lib/ops-insight";
import { TIMELINESS_LIMIT, getBacklogRows, getTimelinessRows } from "@/lib/queries/cockpit";
import { addDays } from "@/lib/task-layout";
import { weekStart } from "@/lib/schemas/time";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/server";

type Person = { id: string; full_name: string; departments: string[] | null };

const HEAT_WEEKS = 12;
const PEOPLE_WEEKS = 8;

function Kpi({ label, value, sub, change, unit = "", good = null, title }: { label: string; value: string; sub?: string; change?: Delta | null; unit?: string; good?: "up" | "down" | null; title?: string }) {
  const tone = !change || change.direction === "same" || !good ? "text-muted-foreground" : change.direction === good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div role="group" aria-label={label} className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {change && (
          <span className={cn("inline-flex items-center text-xs tabular-nums", tone)} title={title}>
            {change.direction === "up" && <ArrowUp aria-hidden className="size-3" />}
            {change.direction === "down" && <ArrowDown aria-hidden className="size-3" />}
            <span className="sr-only">{change.direction === "same" ? "no change" : change.direction === "up" ? "up by" : "down by"}</span>
            {change.direction === "same" ? "same" : `${Math.abs(change.diff)}${unit}`}
          </span>
        )}
      </div>
      {sub && <div className="text-muted-foreground mt-1 text-xs">{sub}</div>}
    </div>
  );
}

const hours = (minutes: number): string => `${(minutes / 60).toFixed(1)} h`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export async function Insight({
  params, scope, people, departments, link,
}: {
  params: InsightParams;
  scope: Scope;
  people: Person[];
  departments: readonly string[];
  link: (p: Partial<InsightParams>) => string;
}) {
  const supabase = await createClient();
  const today = todayIST();
  const range = periodRange(params.period, params.on);
  // Today and the week charts both draw the week around the chosen day; a single day makes a poor chart.
  const chart = params.period === "today" ? periodRange("week", params.on) : range;
  const backlogFrom = params.period === "month" ? range.from : addDays(chart.to, -34);
  const heatFrom = addDays(weekStart(today), -7 * (HEAT_WEEKS - 1));
  const since = [range.prevFrom, chart.from, heatFrom].sort()[0]!;

  const [rowsRes, backlogRes] = await Promise.all([getTimelinessRows(supabase, since), getBacklogRows(supabase, backlogFrom)]);
  if (rowsRes.error || backlogRes.error) return <LoadError what="the operations numbers" />;

  const rawRows = rowsRes.data ?? [];
  const truncated = rawRows.length >= TIMELINESS_LIMIT;
  const rows = normalizeRows(rawRows).filter((t) => inScope(t, scope));
  const backlog: BacklogRow[] = (backlogRes.data ?? []).flatMap((b) =>
    b.snapshot_date
      ? [{ snapshot_date: b.snapshot_date, department: b.department ?? null, assignee_id: b.assignee_id, open_count: b.open_count ?? 0, overdue_count: b.overdue_count ?? 0, blocked_count: b.blocked_count ?? 0, no_deadline_count: b.no_deadline_count ?? 0 }]
      : [],
  );

  const cur = summarize(rows, range.from, range.to);
  const prev = summarize(rows, range.prevFrom, range.prevTo);
  const chartSum = summarize(rows, chart.from, chart.to);
  const open = rows.filter(isOpen);
  const overdueNow = open.filter((t) => t.due_date !== null && t.due_date < today).length;
  const blockedNow = open.filter((t) => t.status === "blocked").length;

  const daily = dailySeries(rows, chart.from, chart.to).filter((d) => !d.weekend || d.done > 0 || d.created > 0);
  const weekdays = weekdayProfile(rows, chart.from, chart.to);
  const bands = latenessBands(rows, chart.from, chart.to);
  const age = overdueAge(rows, today);
  const plan = planVsActual(rows, chart.from, chart.to);
  const backlogPoints = backlogSeries(backlog, backlogFrom, chart.to, scope);
  const heat = heatmap(rows, today, HEAT_WEEKS);
  const heatTotal = heat.reduce((n, w) => n + w.cells.reduce((m, c) => m + c.count, 0), 0);
  const heatBusiest = heat.flatMap((w) => w.cells).reduce((a, c) => (c.count > a.count ? c : a), { day: "", count: 0 });

  const shown = people.filter((p) => (!scope.person || p.id === scope.person) && (!scope.department || (p.departments ?? []).includes(scope.department)));
  const table = peopleTable(rows, shown, range.from, range.to, today).filter((p) => p.done > 0 || p.openNow > 0);
  const weeks = lastWeeks(today, PEOPLE_WEEKS);
  const grid = peopleByWeek(rows, shown, weeks).filter((p) => p.weeks.some((w) => w.done > 0));
  const byWeek = params.period === "month" ? weekLines(rows, range.from, range.to) : [];

  const dueOn = params.period === "today" ? rows.filter((t) => t.original_due_date === params.on) : [];
  const dueDone = dueOn.filter((t) => t.status === "done" && t.done_day !== null && t.done_day <= params.on).length;

  const assigneeLink = (id: string) => `/tasks?tab=team&assignee=${id}`;
  const prevHref = link({ on: shiftPeriod(params.period, params.on, -1) });
  const nextOn = shiftPeriod(params.period, params.on, 1);
  const nextHref = nextOn <= today ? link({ on: nextOn }) : null;
  const versus = `vs ${range.prevLabel}`;
  const firstBacklog = backlogPoints[0];

  return (
    <section aria-label="Operations over time" className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Period" className="flex gap-1">
          {PERIODS.map((p) => (
            <Button key={p} asChild variant={params.period === p ? "secondary" : "ghost"} size="sm">
              <Link href={link({ period: p })} aria-current={params.period === p ? "true" : undefined}>{PERIOD_LABELS[p]}</Link>
            </Button>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={prevHref} aria-label="Previous period"><ChevronLeft aria-hidden className="size-4" /></Link>
          </Button>
          <span className="min-w-36 text-center text-sm font-medium" aria-live="polite">{range.label}</span>
          {nextHref ? (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <Link href={nextHref} aria-label="Next period"><ChevronRight aria-hidden className="size-4" /></Link>
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="size-8" disabled aria-label="Next period">
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          )}
          {params.on !== today && (
            <Button asChild variant="link" size="sm">
              <Link href={link({ on: today })}>Back to now</Link>
            </Button>
          )}
        </div>
        <form method="get" className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="view" value="operations" />
          {params.period !== "week" && <input type="hidden" name="period" value={params.period} />}
          {params.on !== today && <input type="hidden" name="on" value={params.on} />}
          <label className="sr-only" htmlFor="insight-dept">Department</label>
          <select id="insight-dept" name="dept" defaultValue={scope.department ?? ""} className="border-input bg-background h-8 rounded-md border px-2">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d[0]!.toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="insight-person">Person</label>
          <select id="insight-person" name="person" defaultValue={scope.person ?? ""} className="border-input bg-background h-8 rounded-md border px-2">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline">Apply</Button>
        </form>
      </div>

      {truncated && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          There is more work than can be counted at once ({TIMELINESS_LIMIT.toLocaleString("en-IN")} tasks), so some numbers are low. Pick a department or a person to narrow it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Finished"
          value={String(cur.done)}
          change={delta(cur.done, prev.done)}
          good="up"
          title={versus}
          sub={`${cur.early} early, ${cur.onTime} on time, ${cur.late} late${cur.noDeadline ? `, ${cur.noDeadline} no deadline` : ""}`}
        />
        <Kpi
          label="On time or early"
          value={formatPercent(cur.onTimeRate)}
          change={delta(cur.onTimeRate, prev.onTimeRate)}
          unit=" pts"
          good="up"
          title={versus}
          sub={cur.withDeadline > 0 ? `${cur.early + cur.onTime} of ${cur.withDeadline} with a deadline, against the first deadline set` : "Nothing finished had a deadline"}
        />
        <Kpi
          label="Finished late"
          value={String(cur.late)}
          change={delta(cur.late, prev.late)}
          good="down"
          title={versus}
          sub={cur.avgDaysLate === null ? "None late" : `${cur.avgDaysLate} working days late on average`}
        />
        <Kpi
          label="Created"
          value={String(cur.created)}
          change={delta(cur.created, prev.created)}
          title={versus}
          sub={cur.created === cur.done ? "As many finished as created" : cur.created > cur.done ? `${cur.created - cur.done} more created than finished` : `${cur.done - cur.created} more finished than created`}
        />
        <Kpi
          label="Time logged"
          value={hours(cur.loggedMinutes)}
          sub={cur.estimateRatio === null ? "No finished task had an estimate and time" : `Took ${cur.estimateRatio}% of the estimated time`}
        />
        <Kpi label="Overdue now" value={String(overdueNow)} sub={`${plural(open.length, "open task")}, ${blockedNow} blocked, ${cur.reschedules} deadline ${cur.reschedules === 1 ? "move" : "moves"} in this period`} />
      </div>

      {params.period === "today" && (
        <Card>
          <CardHeader>
            <CardTitle>Due that day</CardTitle>
            <CardDescription>Work whose first deadline was {range.label}, and how much of it was finished by the end of the day.</CardDescription>
          </CardHeader>
          <CardContent>
            {dueOn.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing had a deadline on this day.</p>
            ) : (
              <p className="text-sm">
                <span className="text-xl font-semibold tabular-nums">{dueDone}</span> of <span className="tabular-nums">{dueOn.length}</span> finished on time or earlier
                {dueOn.length - dueDone > 0 && <>; <span className="tabular-nums">{dueOn.length - dueDone}</span> still open or finished later</>}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Work finished, day by day</CardTitle>
            <CardDescription>
              Early, on time and late against the first deadline, with what was created as a line. {params.period === "today" ? "Shown for the week around this day. " : ""}Saturday and Sunday are left out unless work happened.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DoneChart
              data={daily}
              summary={`${chartSum.done} finished from ${chart.label}: ${chartSum.early} early, ${chartSum.onTime} on time, ${chartSum.late} late, ${chartSum.noDeadline} with no deadline. ${chartSum.created} created.`}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Open, overdue and blocked</CardTitle>
            <CardDescription>
              The pile at the start of each day, kept every night.{" "}
              {backlogPoints.length === 0
                ? "No history yet; it starts with the next nightly run."
                : firstBacklog && firstBacklog.day > backlogFrom
                  ? `History starts on ${firstBacklog.label}; earlier days were not recorded.`
                  : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {backlogPoints.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing to draw yet.</p>
            ) : (
              <BacklogChart
                data={backlogPoints}
                summary={`From ${firstBacklog?.label}: ${firstBacklog?.open} open, ${firstBacklog?.overdue} overdue. Latest ${backlogPoints.at(-1)?.label}: ${backlogPoints.at(-1)?.open} open, ${backlogPoints.at(-1)?.overdue} overdue, ${backlogPoints.at(-1)?.blocked} blocked.`}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Busy days and quiet days</CardTitle>
            <CardDescription>Work finished each day over the last twelve weeks.</CardDescription>
          </CardHeader>
          <CardContent>
            <CalendarHeatmap
              weeks={heat}
              summary={`${heatTotal} tasks finished in twelve weeks${heatBusiest.count > 0 ? `; the busiest day was ${heatBusiest.day} with ${heatBusiest.count}` : ""}.`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Which weekdays</CardTitle>
            <CardDescription>Average finished on each weekday, and how often that day&apos;s work was late.</CardDescription>
          </CardHeader>
          <CardContent>
            <WeekdayChart
              data={weekdays}
              summary={weekdays.map((d) => `${d.name}: ${d.avgDone} a day${d.lateRate === null ? "" : `, ${d.lateRate}% late`}`).join(". ")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How late</CardTitle>
            <CardDescription>Work finished late, by working days after the first deadline.</CardDescription>
          </CardHeader>
          <CardContent>
            <BandChart data={bands} label="Late work by how late" summary={bands.map((b) => `${b.band}: ${b.count}`).join(". ")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overdue for how long</CardTitle>
            <CardDescription>Work still open past its deadline, by working days waiting.</CardDescription>
          </CardHeader>
          <CardContent>
            <BandChart data={age} label="Overdue work by how long it has waited" summary={age.map((b) => `${b.band}: ${b.count}`).join(". ")} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Estimate against time logged</CardTitle>
            <CardDescription>Each dot is a finished task. On the dashed line it took what was planned; above it, longer.</CardDescription>
          </CardHeader>
          <CardContent>
            {plan.length === 0 ? (
              <p className="text-muted-foreground text-sm">No finished task in this period had both an estimate and logged time.</p>
            ) : (
              <PlanChart data={plan} summary={`${plan.length} finished tasks with an estimate and time logged; together they took ${cur.estimateRatio ?? "an unknown share of"}% of the estimate.`} />
            )}
          </CardContent>
        </Card>

        {byWeek.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Week by week</CardTitle>
              <CardDescription>The month split into weeks (Monday to Sunday), clipped to the month.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead className="text-right">Finished</TableHead>
                    <TableHead className="text-right">Early</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">On time %</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byWeek.map((w) => (
                    <TableRow key={w.from}>
                      <TableCell>{w.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.summary.done}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.summary.early}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.summary.onTime}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.summary.late}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.summary.onTimeRate === null ? "None due" : `${w.summary.onTimeRate}% (${w.summary.early + w.summary.onTime}/${w.summary.withDeadline})`}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.summary.created}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>
              {range.label}. Percentages come with the counts behind them, because two of three is not a trend. Work with no deadline counts as finished but not in the on-time share.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {table.length === 0 ? (
              <p className="text-muted-foreground text-sm">No one finished or holds work in this view.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead className="text-right">Finished</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Overdue now</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Time logged</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Deadline moves</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.map((p) => (
                    <TableRow key={p.id ?? "none"}>
                      <TableCell>
                        {p.id ? <Link className="underline-offset-4 hover:underline" href={assigneeLink(p.id)}>{p.name}</Link> : <span className="text-muted-foreground">{p.name}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.done}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.onTimeRate === null ? "None due" : `${p.onTimeRate}% (${p.withDeadline - p.late}/${p.withDeadline})`}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.late}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.openNow}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.overdueNow}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{hours(p.loggedMinutes)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{p.reschedules}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>People by week</CardTitle>
            <CardDescription>The last {PEOPLE_WEEKS} weeks. The number is what each person finished; the colour is how much of it was on time.</CardDescription>
          </CardHeader>
          <CardContent>
            <PeopleHeatmap rows={grid} taskLink={assigneeLink} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
