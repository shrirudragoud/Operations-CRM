import Link from "next/link";
import { HealthChip, Chip } from "@/components/chips";
import { HealthStrip } from "@/components/health-bar";
import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireMe } from "@/lib/auth";
import { formatDateTime, todayIST } from "@/lib/format";
import { getDays, getOfficeSettings, listTagged } from "@/lib/queries/attendance";
import { buildScope, inScope, insightQuery, parseInsightParams, type InsightParams } from "@/lib/ops-insight";
import { DEPARTMENTS } from "@/lib/permissions";
import { getJobHealth, getLowStock, getOpenTasks, getPeople } from "@/lib/queries/cockpit";
import { summarizeHealth, taskHealth } from "@/lib/task-health";
import { visiblePeople } from "@/lib/workload";
import { createClient } from "@/utils/supabase/server";
import { Insight } from "./insight";

const JOB_LABELS: Record<string, string> = {
  task_automation: "Fixed tasks and reminders",
  kpi_snapshot: "Nightly numbers",
  low_stock: "Low-stock check",
  attendance_retention: "Attendance clean-up",
};
const ATTENTION_ROWS = 10;

export async function Operations({ raw }: { raw: Record<string, string | string[] | undefined> }) {
  const me = await requireMe();
  const founder = me.role === "founder";
  const supabase = await createClient();
  const today = todayIST();
  const [tasksRes, stockRes, jobsRes, settingsRes, taggedRes, daysRes, peopleRes] = await Promise.all([
    getOpenTasks(supabase),
    founder ? getLowStock(supabase) : Promise.resolve({ data: [], error: null }),
    founder ? getJobHealth(supabase) : Promise.resolve({ data: [], error: null }),
    getOfficeSettings(supabase),
    listTagged(supabase),
    getDays(supabase, today, today),
    getPeople(supabase),
  ]);
  if (tasksRes.error || stockRes.error || jobsRes.error || settingsRes.error || taggedRes.error || daysRes.error || peopleRes.error) return <LoadError what="the operations view" />;

  const people = visiblePeople(peopleRes.data ?? [], me);
  const params = parseInsightParams(raw, today, DEPARTMENTS);
  const scope = buildScope(me, people, params);
  const view: InsightParams = { ...params, department: scope.department, person: scope.person };
  const link = (p: Partial<InsightParams>) => {
    const q = new URLSearchParams(insightQuery({ ...view, ...p }, today));
    q.set("view", "operations");
    return `?${q.toString()}`;
  };

  const now = new Date();
  const tasks = (tasksRes.data ?? []).filter((t) => inScope({ assignee_id: t.assignee_id, department: t.department }, scope));
  const summary = summarizeHealth(tasks, now);
  const unowned = tasks.filter((t) => !t.assignee_id).length;
  const attention = tasks
    .map((t) => ({ t, h: taskHealth(t, now) }))
    .filter((x) => x.h.level >= 2)
    .sort((a, b) => b.h.rank - a.h.rank)
    .slice(0, ATTENTION_ROWS);

  const tagged = taggedRes.data ?? [];
  const todayRows = new Map(daysRes.data.map((d) => [d.staff_id, d]));
  const taggedRows = tagged.map((p) => todayRows.get(p.id));
  const inNow = taggedRows.filter((r) => r?.is_open).length;
  const cameIn = taggedRows.filter((r) => r?.first_in).length;
  const noCheckout = taggedRows.filter((r) => r?.missing_checkout).length;
  const expected = taggedRows.filter((r) => r?.expected).length;

  const lowStock = stockRes.data ?? [];
  const jobs = jobsRes.data;

  return (
    <div className="space-y-8">
      <Insight params={view} scope={scope} people={people} departments={scope.departments ? DEPARTMENTS.filter((d) => scope.departments?.has(d)) : DEPARTMENTS} link={link} />

      <h2 className="text-lg font-semibold">Right now</h2>
      <HealthStrip summary={summary} caption={`${summary.total} open tasks ${founder ? "across all departments" : "in your team"}${unowned ? `, ${unowned} with no owner` : ""}`} />
      {summary.total === 0 && <p className="text-muted-foreground text-sm">No open tasks.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              The most urgent open tasks: late, or due today or soon with a problem. <Link className="underline underline-offset-4" href="/tasks?tab=team">All tasks</Link> and <Link className="underline underline-offset-4" href="/workload">team workload</Link>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing is late or at risk.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead className="hidden sm:table-cell">Owner</TableHead>
                    <TableHead>Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attention.map(({ t, h }) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link className="underline-offset-4 hover:underline" href={`/tasks/${t.id}`}>{t.title}</Link>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{t.assignee?.full_name ?? <span className="text-muted-foreground">No owner</span>}</TableCell>
                      <TableCell><HealthChip health={h} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>In the office today</CardTitle>
            <CardDescription>People tagged to check in. <Link className="underline underline-offset-4" href="/attendance?tab=team">Open attendance</Link>.</CardDescription>
          </CardHeader>
          <CardContent>
            {tagged.length === 0 ? (
              <p className="text-muted-foreground text-sm">No one is tagged for attendance yet. Tag people in Team.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Checked in now", inNow],
                  ["Came in today", cameIn],
                  ["Expected today", expected],
                  ["No check-out", noCheckout],
                ].map(([label, n]) => (
                  <li key={label}>
                    <span className="block text-xl font-semibold tabular-nums">{n}</span>
                    <span className="text-muted-foreground text-xs">{label}</span>
                  </li>
                ))}
              </ul>
            )}
            {settingsRes.data && !settingsRes.data.flags_on && tagged.length > 0 && (
              <p className="text-muted-foreground mt-3 text-xs">Late and absent flags are still off (trial period), so only arrivals are counted.</p>
            )}
          </CardContent>
        </Card>

        {founder && (
        <>
        <Card>
          <CardHeader>
            <CardTitle>Low stock</CardTitle>
            <CardDescription>Items at or below their reorder level. <Link className="underline underline-offset-4" href="/inventory">Open Inventory</Link>.</CardDescription>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing is low.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((i) => (
                    <TableRow key={i.item_id}>
                      <TableCell>{i.name}{i.sku ? <span className="text-muted-foreground"> ({i.sku})</span> : null}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.available}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.reorder_level}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Background jobs</CardTitle>
            <CardDescription>The scheduled work that keeps reminders, snapshots and checks going. Overdue means no good run in three times its interval.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Last good run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.job}>
                    <TableCell>{JOB_LABELS[j.job] ?? j.job}</TableCell>
                    <TableCell>{j.last_ok ? formatDateTime(j.last_ok) : <span className="text-muted-foreground">Never</span>}</TableCell>
                    <TableCell>
                      {j.overdue ? (
                        <Chip tone="red" title={j.last_error ?? undefined}>{j.last_started ? "Overdue" : "Not scheduled yet"}</Chip>
                      ) : j.last_status === "failed" ? (
                        <Chip tone="amber" title={j.last_error ?? undefined}>Last run failed</Chip>
                      ) : (
                        <Chip tone="green">Running</Chip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
        )}
      </div>
    </div>
  );
}
