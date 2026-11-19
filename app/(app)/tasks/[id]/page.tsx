import type { Metadata } from "next";
import { PriorityChip, TaskStatusChip } from "@/components/chips";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LoadError } from "@/components/load-error";
import { NewTaskButton } from "@/components/new-task-dialog";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMe } from "@/lib/auth";
import { formatDate, formatDateTime, todayIST } from "@/lib/format";
import {
  DEPARTMENT_LABELS, type Department, canAcceptTask, canClaimTask, canCreateTask, canDeclineTask, canDelete, canEditTaskDetails,
  canManageTask, canManageWatchers, canReassignTask, canReopenTask, canScheduleTask, canTrackTime, canWrite,
} from "@/lib/permissions";
import { listOwners } from "@/lib/queries/institution";
import { listWatchers } from "@/lib/queries/task-collab";
import { getRunningTimer, listTaskTime } from "@/lib/queries/time";
import {
  getParentTask, getTask, getTaskEntity, listGroupTasks, listSubtasks, listTaskComments, listTaskHistory,
} from "@/lib/queries/tasks";
import { type TaskStatus } from "@/lib/schemas/activity";
import { TASK_CATEGORY_LABELS, describeHistory, formatMinutes, formatSpan, isOverdue, type TaskCategory } from "@/lib/schemas/task";
import { TIME_EDIT_DAYS } from "@/lib/schemas/time";
import { addDays } from "@/lib/task-layout";
import { createClient } from "@/utils/supabase/server";
import { Comments } from "./comments";
import { TaskActions } from "./task-actions";
import { AssignControl, CancelGroup, TaskEditForm } from "./task-edit";
import { TaskTime } from "./time";
import { Watchers } from "./watchers";

export const metadata: Metadata = { title: "Task" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMe();
  const crumbs = [{ label: "Tasks", href: "/tasks" }];
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: t, error } = await getTask(supabase, id);
  if (error) return <><PageHeader title="Task" crumbs={crumbs} /><LoadError what="this task" /></>;
  if (!t) notFound();

  const canTrack = canTrackTime(me);
  const [subtasks, comments, history, owners, parent, entity, watchers, timeList, running, group] = await Promise.all([
    listSubtasks(supabase, id),
    listTaskComments(supabase, id),
    listTaskHistory(supabase, id),
    listOwners(supabase),
    t.parent_task_id ? getParentTask(supabase, t.parent_task_id) : Promise.resolve({ data: null }),
    getTaskEntity(supabase, t.entity_type, t.entity_id),
    listWatchers(supabase, id),
    listTaskTime(supabase, id),
    canTrack ? getRunningTimer(supabase, me.id) : Promise.resolve({ data: null }),
    t.group_id ? listGroupTasks(supabase, t.group_id) : Promise.resolve({ data: null }),
  ]);

  const status = t.status as TaskStatus;
  const open = status === "todo" || status === "doing" || status === "blocked";
  const staff = (owners.data ?? []).filter((o) => o.role !== "partner" && o.role !== "viewer").map((o) => ({ id: o.id, full_name: o.full_name, departments: o.departments }));
  const subs = subtasks.data ?? [];
  const openSubs = subs.filter((s) => s.status === "todo" || s.status === "doing" || s.status === "blocked").length;
  const assigneeDepartments = (owners.data ?? []).find((o) => o.id === t.assignee_id)?.departments as Department[] | undefined;
  const ref = { ...t, assignee_departments: assigneeDepartments ?? null };
  const groupTasks = group.data ?? [];
  const groupOpen = groupTasks.filter((g) => g.status === "todo" || g.status === "doing" || g.status === "blocked").length;
  const canSchedule = canScheduleTask(me, ref);
  const flags = {
    canMove: canSchedule,
    canReopen: canReopenTask(me, ref),
    canAccept: canAcceptTask(me, ref) && open,
    canClaim: canClaimTask(me, ref) && open,
    canDecline: canDeclineTask(me, ref) && open,
    canDelete: t.department ? canDelete(me, t.department) : me.role === "founder" || (me.role === "dept_lead" && !!assigneeDepartments?.some((d) => me.departments.includes(d)) && t.assignee_id !== me.id),
  };
  const overdue = isOverdue(t);
  const editValues = {
    id: t.id,
    title: t.title,
    description: t.description ?? "",
    department: (t.department ?? "") as Department | "",
    category: (t.category ?? "") as TaskCategory | "",
    start_date: t.start_date ?? "",
    due_date: t.due_date ?? "",
    due_time: t.due_time ? t.due_time.slice(0, 5) : "",
    priority: String(t.priority),
    estimate_minutes: t.estimate_minutes === null ? "" : String(t.estimate_minutes),
  };

  const commentViews = (comments.data ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    at: formatDateTime(c.created_at),
    author: c.author?.full_name ?? "Unknown",
    canDelete: c.author_id === me.id || me.role === "founder",
  }));

  const today = todayIST();
  const editFrom = addDays(today, -TIME_EDIT_DAYS);
  const timeRows = timeList.data ?? [];
  const entryViews = timeRows.map((e) => ({
    id: e.id,
    who: e.staff?.full_name ?? "Unknown",
    day: formatDate(e.work_date),
    workDate: e.work_date,
    minutes: e.minutes,
    startedAt: e.ended_at === null ? e.started_at : null,
    note: e.note,
    timed: e.source === "timer",
    canEdit: canTrack && e.staff_id === me.id && e.work_date >= editFrom,
  }));
  const loggedMinutes = timeRows.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
  const myTimer = running.data && running.data.task_id === t.id ? running.data.id : null;
  const otherTimer = running.data && running.data.task_id !== t.id ? { taskId: running.data.task_id, title: running.data.task?.title ?? "another task" } : null;

  return (
    <>
      <PageHeader
        title={t.title}
        crumbs={[...crumbs, ...(parent.data ? [{ label: parent.data.title, href: `/tasks/${parent.data.id}` }] : []), { label: t.title }]}
        description={`${t.department ? DEPARTMENT_LABELS[t.department] : "No department"}${t.category ? ` · ${TASK_CATEGORY_LABELS[t.category as TaskCategory]}` : ""} · created by ${t.creator?.full_name ?? "the system"} on ${formatDateTime(t.created_at)}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TaskStatusChip status={status} />
        <PriorityChip priority={t.priority} />
        <span className="text-sm">{t.start_date ? "Scheduled" : "Due"} {formatSpan(t.start_date, t.due_date, t.due_time)}</span>
        {overdue && <Badge variant="destructive">Overdue</Badge>}
        {t.recurrence_id && <Badge variant="outline">Fixed task</Badge>}
        {parent.data && <Link className="text-sm underline-offset-4 hover:underline" href={`/tasks/${parent.data.id}`}>Subtask of {parent.data.title}</Link>}
      </div>

      {status === "blocked" && t.blocked_reason && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Blocked</AlertTitle>
          <AlertDescription>{t.blocked_reason}</AlertDescription>
        </Alert>
      )}
      {status === "cancelled" && t.cancel_reason && (
        <Alert className="mb-4">
          <AlertTitle>Cancelled</AlertTitle>
          <AlertDescription>{t.cancel_reason}</AlertDescription>
        </Alert>
      )}

      {canWrite(me) && (
        <div className="mb-6">
          <TaskActions id={t.id} meId={me.id} title={t.title} status={status} flags={flags} onDeletedHref={parent.data ? `/tasks/${parent.data.id}` : "/tasks"} />
          {status === "doing" && openSubs > 0 && (
            <p className="text-muted-foreground mt-2 text-sm">{openSubs} {openSubs === 1 ? "subtask is" : "subtasks are"} still open. Finish them before this task.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              {canSchedule ? (
                <TaskEditForm key={t.updated_at} values={editValues} canEditDetails={canEditTaskDetails(me, ref)} canSchedule={canSchedule} groupSize={groupTasks.length} canEditGroup={t.group_id !== null && (me.role === "founder" || t.created_by === me.id)} />
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="whitespace-pre-wrap">{t.description || <span className="text-muted-foreground">No details.</span>}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {!t.parent_task_id && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Subtasks {subs.length > 0 && <span className="text-muted-foreground text-sm font-normal">{subs.length - openSubs}/{subs.length} done</span>}</CardTitle>
                {canCreateTask(me) && open && (
                  <NewTaskButton owners={staff} defaultDepartment={t.department ?? null} meId={me.id} parentTaskId={t.id} label="Add subtask" variant="outline" />
                )}
              </CardHeader>
              <CardContent>
                {subs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Break a big task into steps and give each one an owner.</p>
                ) : (
                  <ul className="divide-y" aria-label="Subtasks">
                    {subs.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link className="text-sm underline-offset-4 hover:underline" href={`/tasks/${s.id}`}>{s.title}</Link>
                        <span className="text-muted-foreground flex items-center gap-2 text-xs">
                          {s.assignee?.full_name ?? "Unassigned"}
                          <TaskStatusChip status={s.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
            <CardContent><Comments taskId={t.id} comments={commentViews} canComment={canWrite(me)} people={staff.filter((o) => o.id !== me.id)} /></CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>People</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-3">
                <Fact label="Assigned to">
                  {t.assignee?.full_name ?? "Unassigned"}
                  {t.assignee_id && open && <span className="text-muted-foreground ml-1 text-xs">{t.accepted_at ? `(accepted ${formatDateTime(t.accepted_at)})` : "(not accepted yet)"}</span>}
                </Fact>
                {t.assigned_by && <Fact label="Assigned by">{t.assigner?.full_name ?? "-"}{t.assigned_at ? `, ${formatDateTime(t.assigned_at)}` : ""}</Fact>}
                <Fact label="Estimate">{formatMinutes(t.estimate_minutes)}</Fact>
                {entity && <Fact label="Linked to"><Link className="underline-offset-4 hover:underline" href={entity.href}>{entity.label}</Link></Fact>}
                {t.completed_at && <Fact label="Finished">{t.completer?.full_name ?? "-"}, {formatDateTime(t.completed_at)}</Fact>}
              </dl>
              {open && canReassignTask(me, ref) && <AssignControl taskId={t.id} current={t.assignee_id} owners={staff} />}
              {open && !canReassignTask(me, ref) && canManageTask(me, ref) === false && (
                <p className="text-muted-foreground text-xs">Only the person who assigned this task, a department lead or a founder can hand it to someone else.</p>
              )}
            </CardContent>
          </Card>

          {t.group_id && groupTasks.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Given to {groupTasks.length === 1 ? "several people" : `${groupTasks.length} people`}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <ul className="divide-y" aria-label="Group">
                  {groupTasks.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      {g.id === t.id ? <span className="font-medium">{g.assignee?.full_name ?? "Unassigned"} (this task)</span> : (
                        <Link className="underline-offset-4 hover:underline" href={`/tasks/${g.id}`}>{g.assignee?.full_name ?? "Unassigned"}</Link>
                      )}
                      <TaskStatusChip status={g.status} />
                    </li>
                  ))}
                </ul>
                {groupTasks.length === 1 && <p className="text-muted-foreground text-xs">You can only see your own copy. Each person finishes theirs on their own time.</p>}
                {(me.role === "founder" || t.created_by === me.id) && groupOpen > 0 && <CancelGroup taskId={t.id} open={groupOpen} />}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Time</CardTitle></CardHeader>
            <CardContent>
              <TaskTime
                taskId={t.id}
                today={today}
                entries={entryViews}
                loggedMinutes={loggedMinutes}
                estimateLabel={formatMinutes(t.estimate_minutes)}
                estimateMinutes={t.estimate_minutes}
                myTimerId={myTimer}
                otherTimer={otherTimer}
                canTrack={canTrack}
                canStart={open}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Watchers</CardTitle></CardHeader>
            <CardContent>
              <Watchers
                taskId={t.id}
                meId={me.id}
                watchers={(watchers.data ?? []).map((w) => ({ staffId: w.staff_id, name: w.staff?.full_name ?? "Unknown" }))}
                owners={staff}
                canWrite={canWrite(me) && me.role !== "partner"}
                canManage={canManageWatchers(me, ref)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3" aria-label="History">
                {(history.data ?? []).map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="font-medium">{h.actor?.full_name ?? "System"}</span> {describeHistory(h)}
                    <div className="text-muted-foreground text-xs">{formatDateTime(h.at)}</div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
