import type { Metadata } from "next";
import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { HealthBar, HealthStrip } from "@/components/health-bar";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { listMinutesBetween, listOpenAssignedTasks } from "@/lib/queries/time";
import { listRecentlyDone, ON_TIME_DAYS } from "@/lib/queries/tasks";
import { formatMinutes } from "@/lib/schemas/task";
import { formatHM, weekDays, weekStart } from "@/lib/schemas/time";
import { summarizeHealth } from "@/lib/task-health";
import { TONE_TEXT } from "@/lib/tone";
import { buildWorkload, OVERLOAD_MINUTES, visiblePeople } from "@/lib/workload";
import { cn } from "cn";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Team workload" };

export default async function WorkloadPage() {
  const { me, allowed } = await requireArea("workload");
  if (!allowed) return <><PageHeader title="Team workload" /><AccessDenied what="team workload" /></>;

  const supabase = await createClient();
  const today = todayIST();
  const monday = weekStart(today);
  const sunday = weekDays(monday)[6] ?? monday;

  const [staffRes, tasksRes, minutesRes, doneRes] = await Promise.all([
    supabase.from("staff").select("id, full_name, role, departments").eq("is_active", true).order("full_name").limit(500),
    listOpenAssignedTasks(supabase),
    listMinutesBetween(supabase, monday, sunday),
    listRecentlyDone(supabase, null),
  ]);

  const header = <PageHeader title="Team workload" description="Open work, how healthy the deadlines are, on-time rate and time logged for your people." />;
  if (staffRes.error || tasksRes.error || minutesRes.error || doneRes.error) return <>{header}<LoadError what="the workload" /></>;

  const people = visiblePeople(staffRes.data ?? [], me).map((s) => ({ id: s.id, full_name: s.full_name }));
  const ids = new Set(people.map((p) => p.id));
  const tasks = (tasksRes.data ?? []).filter((t) => t.assignee_id && ids.has(t.assignee_id));
  const rows = buildWorkload({
    people,
    tasks,
    minutes: minutesRes.data ?? [],
    done: (doneRes.data ?? []).filter((d) => d.assignee_id && ids.has(d.assignee_id)),
    today,
  });
  const everyone = summarizeHealth(tasks);

  return (
    <>
      {header}
      <HealthStrip summary={everyone} caption="Open tasks of the people below" />
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            Week of {formatDate(monday)}. Most in need of attention first. Estimates are what people typed on open tasks; more than {formatMinutes(OVERLOAD_MINUTES)} is flagged as a heavy load.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><UsersIcon aria-hidden /></EmptyMedia>
                <EmptyTitle>No one to show yet</EmptyTitle>
                <EmptyDescription>People who share a department with you will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">At risk</TableHead>
                  <TableHead className="text-right">Due in 7 days</TableHead>
                  <TableHead className="text-right">Estimated</TableHead>
                  <TableHead className="text-right">Logged this week</TableHead>
                  <TableHead className="text-right">On time, {ON_TIME_DAYS} days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link className="underline-offset-4 hover:underline" href={`/tasks?tab=team&assignee=${r.id}`}>{r.full_name}</Link>
                    </TableCell>
                    <TableCell className="text-right">{r.open}</TableCell>
                    <TableCell className="w-36 min-w-28">{r.health.total > 0 ? <HealthBar summary={r.health} /> : <span className="text-muted-foreground text-sm">-</span>}</TableCell>
                    <TableCell className="text-right">
                      {r.overdue > 0 ? <Badge variant="destructive">{r.overdue}</Badge> : 0}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.health.atRisk > 0 ? <span className={cn("font-medium", TONE_TEXT.orange)}>{r.health.atRisk}</span> : 0}
                    </TableCell>
                    <TableCell className="text-right">{r.dueSoon}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.estimatedMinutes ? formatMinutes(r.estimatedMinutes) : "-"}
                      {r.unestimated > 0 && <span className="text-muted-foreground ml-1 text-xs">({r.unestimated} without)</span>}
                      {r.overloaded && <Badge variant="destructive" className="ml-2">Heavy</Badge>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatHM(r.weekMinutes)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.onTime.rate === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span title={`${r.onTime.total} finished tasks with a deadline`} className={cn("font-medium tabular-nums", r.onTime.rate >= 80 ? TONE_TEXT.green : r.onTime.rate >= 50 ? TONE_TEXT.amber : TONE_TEXT.red)}>
                          {r.onTime.rate}%
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
