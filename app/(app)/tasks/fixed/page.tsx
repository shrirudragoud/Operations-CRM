import type { Metadata } from "next";
import Link from "next/link";
import { RepeatIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireMe } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { DEPARTMENT_LABELS, DEPARTMENTS, canManageRecurrence, canSeeFixedTasks, type Department } from "@/lib/permissions";
import { listOwners } from "@/lib/queries/institution";
import { listRecurrences } from "@/lib/queries/task-collab";
import { describeRecurrence, PRIORITY_LABELS, type Priority, type RecurrenceFrequency } from "@/lib/schemas/task";
import { createClient } from "@/utils/supabase/server";
import { FixedTaskButton, type RecurrenceFormValues } from "./fixed-form";
import { FixedRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Fixed tasks" };

export default async function FixedTasksPage() {
  const me = await requireMe();
  const crumbs = [{ label: "Tasks", href: "/tasks" }, { label: "Fixed tasks" }];
  if (!canSeeFixedTasks(me)) {
    return <><PageHeader title="Fixed tasks" crumbs={crumbs} /><AccessDenied what="fixed tasks" /></>;
  }

  const supabase = await createClient();
  const [list, owners] = await Promise.all([listRecurrences(supabase), listOwners(supabase)]);
  const departments: Department[] = DEPARTMENTS.filter((d) => canManageRecurrence(me, d));
  const staff = (owners.data ?? []).filter((o) => o.role !== "partner" && o.role !== "viewer").map((o) => ({ id: o.id, full_name: o.full_name }));
  const names = new Map(staff.map((s) => [s.id, s.full_name]));
  const today = todayIST();
  const create = <FixedTaskButton departments={departments} staff={staff} today={today} />;
  const header = (
    <PageHeader
      title="Fixed tasks"
      crumbs={crumbs}
      description="Work that repeats. Set it once for a department or for chosen people; the system creates a normal task for each person on schedule."
      actions={create}
    />
  );
  if (list.error) return <>{header}<LoadError what="fixed tasks" /></>;
  const rows = list.data ?? [];

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RepeatIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No fixed tasks yet</EmptyTitle>
            <EmptyDescription>For example a daily workshop log, a weekly stock check, or a monthly report. Each person gets their own task with a start and a deadline.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      {header}
      <ul className="space-y-3" aria-label="Fixed tasks">
        {rows.map((r) => {
          const initial: RecurrenceFormValues = {
            id: r.id,
            title: r.title,
            description: r.description ?? "",
            department: r.department,
            priority: String(r.priority),
            estimate_minutes: r.estimate_minutes === null ? "" : String(r.estimate_minutes),
            frequency: r.frequency as RecurrenceFrequency,
            weekday: r.weekday === null ? "1" : String(r.weekday),
            month_day: r.month_day === null ? "1" : String(r.month_day),
            due_after_days: String(r.due_after_days),
            due_time: r.due_time ? r.due_time.slice(0, 5) : "",
            starts_on: r.starts_on,
            ends_on: r.ends_on ?? "",
            all_department: r.all_department,
            staff_ids: r.staff_ids,
            active: r.active,
          };
          const manage = canManageRecurrence(me, r.department);
          const who = r.all_department
            ? `Everyone in ${DEPARTMENT_LABELS[r.department]}`
            : r.staff_ids.map((id) => names.get(id) ?? "Former teammate").join(", ");
          return (
            <li key={r.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {r.title}
                      <Badge variant={r.active ? "secondary" : "outline"}>{r.active ? "Active" : "Paused"}</Badge>
                      <Badge variant="outline">{DEPARTMENT_LABELS[r.department]}</Badge>
                    </p>
                    <p className="text-muted-foreground text-sm">{describeRecurrence(r)} · {PRIORITY_LABELS[r.priority as Priority] ?? r.priority} priority</p>
                    <p className="text-muted-foreground text-sm">For: {who}</p>
                    <p className="text-muted-foreground text-xs">
                      From {formatDate(r.starts_on)}
                      {r.ends_on ? ` to ${formatDate(r.ends_on)}` : ""} · set up by {r.creator?.full_name ?? "the system"}
                    </p>
                  </div>
                  {manage && (
                    <div className="flex flex-wrap gap-2">
                      <FixedTaskButton departments={departments} staff={staff} today={today} initial={initial} label="Edit" variant="outline" />
                      <FixedRowActions id={r.id} title={r.title} active={r.active} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground mt-4 text-sm">
        Generated tasks are normal tasks on <Link className="underline underline-offset-4" href="/tasks">Tasks</Link>. If one is not needed, cancel it; deleting it lets the schedule create it again for the same period.
      </p>
    </>
  );
}
