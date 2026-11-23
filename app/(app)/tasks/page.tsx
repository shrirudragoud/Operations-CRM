import type { Metadata } from "next";
import { DepartmentChip, HealthChip, PriorityChip, TaskStatusChip } from "@/components/chips";
import { HealthStrip } from "@/components/health-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { AvatarStack } from "@/components/tasks/avatar-stack";
import { SubtaskPeek } from "@/components/tasks/subtask-peek";
import { clusterCopies, clusterHealth, clusterProgress, clusterStatus } from "@/lib/task-groups";
import { summarizeHealth, taskHealth, type SubRollup } from "@/lib/task-health";
import { TONE_PANEL } from "@/lib/tone";
import { cn } from "cn";
import Link from "next/link";
import { ListChecksIcon, RepeatIcon, SearchIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { FilterLinks } from "@/components/filter-links";
import { LoadError } from "@/components/load-error";
import { NewTaskButton } from "@/components/new-task-dialog";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { TaskStatusButton } from "@/components/task-status-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { DEPARTMENT_LABELS, DEPARTMENTS, canCreateTask, canSeeFixedTasks, canUpdateTask } from "@/lib/permissions";
import { listOwners } from "@/lib/queries/institution";
import { listTaskViews } from "@/lib/queries/task-collab";
import { cardExtras, groupTotals, listTasksForLayout, listTasks, parentTitles, sharedOwners, subtaskCounts, tabCounts, type CardExtras, type OwnerRow, type TaskRowRolled } from "@/lib/queries/tasks";
import {
  formatDue, formatMinutes, LAYOUT_LABELS, parseTaskParams, TASK_LAYOUTS, TASK_PAGE_SIZE, taskQuery,
  type TaskParams, type TaskTab,
} from "@/lib/schemas/task";
import { LAYOUT_LIMIT, layoutWindow } from "@/lib/task-layout";
import { createClient } from "@/utils/supabase/server";
import { TaskBoard } from "./_views/board";
import { TaskCalendar } from "./_views/calendar";
import { SavedViews } from "./_views/saved-views";
import { TaskTimeline } from "./_views/timeline";

export const metadata: Metadata = { title: "Tasks" };

type Raw = Record<string, string | string[] | undefined>;

const TAB_LABELS: Record<TaskTab, string> = { mine: "Assigned to me", team: "Team", created: "Created by me" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const { me, allowed } = await requireArea("tasks");
  if (!allowed) {
    return <><PageHeader title="Tasks" /><AccessDenied what="Tasks" /></>;
  }

  const p = parseTaskParams(await searchParams);
  const href = (patch: Partial<TaskParams>) => {
    const qs = taskQuery({ ...p, page: 1, ...patch });
    return qs ? `/tasks?${qs}` : "/tasks";
  };

  const supabase = await createClient();
  const layout = p.layout !== "list";
  const [list, counts, owners, savedViews] = await Promise.all([
    layout ? listTasksForLayout(supabase, me, p, layoutWindow(p.layout, p.at)) : listTasks(supabase, me, p),
    tabCounts(supabase, me),
    listOwners(supabase),
    listTaskViews(supabase),
  ]);
  const staff = (owners.data ?? []).filter((o) => o.role !== "partner" && o.role !== "viewer");
  const defaultDepartment = me.departments[0] ?? "sales";
  const create = canCreateTask(me) ? (
    <NewTaskButton owners={staff.map((o) => ({ id: o.id, full_name: o.full_name, departments: o.departments }))} defaultDepartment={defaultDepartment} meId={me.id} />
  ) : undefined;
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <SavedViews
        views={savedViews.data ?? []}
        meId={me.id}
        currentQuery={taskQuery({ ...p, page: 1 })}
        canSave={canCreateTask(me)}
      />
      {canSeeFixedTasks(me) && <Button asChild variant="outline"><Link href="/tasks/fixed"><RepeatIcon aria-hidden /> Fixed tasks</Link></Button>}
      {create}
    </div>
  );
  const pageHeader = <PageHeader title="Tasks" description="Assign work to anyone on the team, track it to done, and talk about it in one place." actions={actions} />;

  const tabs = (
    <nav aria-label="Task lists" className="mb-4 flex flex-wrap gap-1 border-b">
      {(Object.keys(TAB_LABELS) as TaskTab[]).map((t) => (
        <Link
          key={t}
          href={href({ tab: t, department: t === "team" ? p.department : "", assignee: "" })}
          aria-current={p.tab === t ? "page" : undefined}
          className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${p.tab === t ? "border-primary font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
        >
          {TAB_LABELS[t]}
          <Badge variant="secondary">{counts[t]}</Badge>
        </Link>
      ))}
    </nav>
  );

  const filters = (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      <FilterLinks
        label="Layout"
        current={p.layout}
        options={TASK_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABELS[l] }))}
        href={(l) => href({ layout: l, at: "" })}
      />
      <FilterLinks
        label="Show"
        current={p.view}
        options={[{ value: "open", label: "Open" }, { value: "done", label: "Finished" }, { value: "all", label: "All" }]}
        href={(view) => href({ view })}
      />
      {p.tab !== "mine" && (
        <FilterLinks
          label="Subtasks"
          current={p.subtasks ? "1" : ""}
          options={[{ value: "", label: "Hidden" }, { value: "1", label: "Shown" }]}
          href={(v) => href({ subtasks: v === "1" })}
        />
      )}
      {p.tab === "team" && (
        <>
          <FilterLinks
            label="Department"
            current={p.department}
            options={[{ value: "", label: "All" }, ...DEPARTMENTS.map((d) => ({ value: d as string, label: DEPARTMENT_LABELS[d] }))]}
            href={(department) => href({ department })}
          />
          <FilterLinks
            label="Owner"
            current={p.assignee === "none" ? "none" : ""}
            options={[{ value: "", label: "Anyone" }, { value: "none", label: "Unassigned" }]}
            href={(assignee) => href({ assignee })}
          />
        </>
      )}
      <form action="/tasks" role="search" className="ml-auto flex items-center gap-2">
        {p.layout !== "board" && <input type="hidden" name="layout" value={p.layout} />}
        {p.at && <input type="hidden" name="at" value={p.at} />}
        {p.tab !== "mine" && <input type="hidden" name="tab" value={p.tab} />}
        {p.view !== "open" && <input type="hidden" name="view" value={p.view} />}
        {p.department && <input type="hidden" name="department" value={p.department} />}
        {p.assignee && <input type="hidden" name="assignee" value={p.assignee} />}
        {p.subtasks && <input type="hidden" name="subtasks" value="1" />}
        <Input name="q" defaultValue={p.q} placeholder="Search titles…" aria-label="Search tasks" className="h-8 w-48" />
        <Button type="submit" size="sm" variant="outline"><SearchIcon aria-hidden /> Search</Button>
      </form>
    </div>
  );

  if (list.error) return <>{pageHeader}{tabs}{filters}<LoadError what="tasks" /></>;
  const rows = list.data ?? [];
  const total = list.count ?? 0;

  if (layout) {
    const link = (patch: Partial<TaskParams>) => href(patch);
    const ids = rows.map((r) => r.id);
    const lone = clusterCopies(rows, me.id).filter((c) => c.copies.length === 1 && c.lead.group_id).map((c) => c.lead.group_id as string);
    const [roll, extras, parents, totals, shared] = await Promise.all([
      p.layout === "board" ? Promise.resolve(new Map<string, SubRollup>()) : subtaskCounts(supabase, ids),
      p.layout === "board" ? cardExtras(supabase, ids) : Promise.resolve(new Map<string, CardExtras>()),
      p.layout === "board" ? parentTitles(supabase, rows.flatMap((r) => (r.parent_task_id ? [r.parent_task_id] : []))) : Promise.resolve(new Map<string, string>()),
      p.layout === "board" ? groupTotals(supabase, lone) : Promise.resolve(new Map<string, { done: number; total: number }>()),
      p.layout === "board" ? sharedOwners(supabase, rows.filter((r) => r.shared).map((r) => r.id)) : Promise.resolve(new Map<string, OwnerRow[]>()),
    ]);
    const rollOf = (id: string): SubRollup | undefined => extras.get(id) ?? roll.get(id);
    const rolled: TaskRowRolled[] = rows.map((r) => {
      const s = rollOf(r.id);
      return s ? { ...r, subOpen: s.subOpen, subOverdue: s.subOverdue, subBlocked: s.subBlocked } : r;
    });
    const addTask = canCreateTask(me) ? (
      <NewTaskButton
        owners={staff.map((o) => ({ id: o.id, full_name: o.full_name, departments: o.departments }))}
        defaultDepartment={defaultDepartment}
        meId={me.id}
        label="Add task"
        variant="ghost"
      />
    ) : undefined;
    return (
      <>
        {pageHeader}
        {tabs}
        {filters}
        {total > rows.length && (
          <p className="text-muted-foreground mb-4 text-sm" role="status">
            Showing the first {LAYOUT_LIMIT} tasks. Narrow it down with the filters or search.
          </p>
        )}
        {p.view !== "done" && <HealthStrip summary={summarizeHealth(rolled)} caption={total > rows.length ? `First ${rows.length} tasks` : "Open tasks in this list"} />}
        {rows.length === 0 && p.layout !== "timeline" && p.layout !== "calendar" ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ListChecksIcon aria-hidden /></EmptyMedia>
              <EmptyTitle>{p.q ? "No tasks match that search" : "No tasks here"}</EmptyTitle>
              <EmptyDescription>Try another list or filter, or create a task.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : p.layout === "board" ? (
          <TaskBoard me={me} tasks={rows} view={p.view} extras={extras} parents={parents} groupTotals={totals} owners={shared} create={addTask} />
        ) : p.layout === "calendar" ? (
          <TaskCalendar tasks={rolled} params={p} link={link} />
        ) : (
          <TaskTimeline tasks={rolled} params={p} link={link} />
        )}
      </>
    );
  }

  const pages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));

  if (total === 0) {
    const mineOpen = p.tab === "mine" && p.view === "open";
    return (
      <>
        {pageHeader}
        {tabs}
        {filters}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ListChecksIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>{mineOpen ? "Nothing on your list" : p.q ? "No tasks match that search" : "No tasks here"}</EmptyTitle>
            <EmptyDescription>
              {mineOpen
                ? "Tasks assigned to you appear here. Pick one from the Team list, or create one."
                : "Try another list or filter, or create a task."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        {pageHeader}
        {tabs}
        {filters}
        <Empty className="border">
          <EmptyHeader><EmptyTitle>That page is past the end</EmptyTitle></EmptyHeader>
          <Button asChild variant="outline"><Link href={href({ page: 1 })}>Back to page 1</Link></Button>
        </Empty>
      </>
    );
  }

  const loneGroups = clusterCopies(rows, me.id).filter((c) => c.copies.length === 1 && c.lead.group_id).map((c) => c.lead.group_id as string);
  const [subs, parents, totals, shared] = await Promise.all([
    subtaskCounts(supabase, rows.map((r) => r.id)),
    parentTitles(supabase, rows.flatMap((r) => (r.parent_task_id ? [r.parent_task_id] : []))),
    groupTotals(supabase, loneGroups),
    sharedOwners(supabase, rows.filter((r) => r.shared).map((r) => r.id)),
  ]);
  const now = new Date();
  return (
    <>
      {pageHeader}
      {tabs}
      {filters}
      {p.view !== "done" && <HealthStrip summary={summarizeHealth(rows.map((r) => ({ ...r, ...subs.get(r.id) })), now)} caption="Open tasks on this page" />}
      <div className="space-y-4">
        <Table aria-label="Tasks">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead className="hidden sm:table-cell">Department</TableHead>
              <TableHead className="hidden md:table-cell">Assignee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Priority</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clusterCopies(rows, me.id).map(({ lead: t, copies }) => {
              const grouped = copies.length > 1;
              const statuses = copies.map((c) => c.status);
              const status = grouped ? clusterStatus(statuses) : t.status;
              const progress = clusterProgress(statuses);
              const open = status === "todo" || status === "doing" || status === "blocked";
              const sub = subs.get(t.id);
              const health = grouped ? clusterHealth(copies.map((c) => ({ ...c, ...subs.get(c.id) })), now) : taskHealth({ ...t, ...sub }, now);
              const canAct = !grouped && open && canUpdateTask(me, t);
              const groupCount = !grouped && t.group_id ? totals.get(t.group_id) : undefined;
              const coOwners = t.shared ? shared.get(t.id) ?? [] : [];
              const parentTitle = t.parent_task_id ? parents.get(t.parent_task_id) : undefined;
              return (
                <TableRow key={t.id} className={cn(health.level >= 2 && TONE_PANEL[health.tone])}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-4 hover:underline" href={`/tasks/${t.id}`}>{t.title}</Link>
                    {!grouped && t.estimate_minutes ? <span className="text-muted-foreground ml-2 text-xs font-normal">{formatMinutes(t.estimate_minutes)}</span> : null}
                    {t.parent_task_id && (
                      <div className="text-muted-foreground text-xs font-normal">
                        {parentTitle ? <>Part of <Link className="underline-offset-4 hover:underline" href={`/tasks/${t.parent_task_id}`}>{parentTitle}</Link></> : "Subtask"}
                      </div>
                    )}
                    {grouped && (
                      <div className="text-muted-foreground text-xs font-normal">
                        <Link className="underline-offset-4 hover:underline" href={`/tasks/${t.id}`}>Given to {copies.length} people</Link> · {progress.done} of {progress.total} done
                      </div>
                    )}
                    {!grouped && t.group_id && (
                      <Badge variant="outline" className="mt-1 font-normal" title="Given to several people. Each finishes their own copy.">
                        Shared{groupCount ? ` · ${groupCount.done} of ${groupCount.total} done` : ""}
                      </Badge>
                    )}
                    {t.shared && (
                      <Badge variant="outline" className="mt-1 font-normal" title="One task owned by several people. Whoever finishes it finishes it for all.">
                        Shared task · {coOwners.length || "several"} owners
                      </Badge>
                    )}
                    {sub && sub.items.length > 0 && <div className="mt-1 font-normal"><SubtaskPeek title={t.title} subs={sub.items} /></div>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell"><DepartmentChip department={t.department} /></TableCell>
                  <TableCell className="hidden md:table-cell">
                    {grouped ? (
                      <span className="flex items-center gap-2">
                        <AvatarStack names={copies.map((c) => c.assignee?.full_name ?? "Unassigned")} />
                        {copies.length} people
                      </span>
                    ) : t.shared && coOwners.length > 1 ? (
                      <span className="flex items-center gap-2">
                        <AvatarStack names={coOwners.map((o) => o.full_name)} />
                        {coOwners.length} owners
                      </span>
                    ) : t.assignee ? (
                      <span className="flex items-center gap-2">
                        <Avatar size="sm"><AvatarFallback className="text-[10px]">{initials(t.assignee.full_name)}</AvatarFallback></Avatar>
                        {t.assignee.full_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">Unassigned</span>
                    )}
                    {!grouped && t.assignee_id && !t.accepted_at && open && <span className="text-muted-foreground ml-1 text-xs">(not accepted)</span>}
                  </TableCell>
                  <TableCell>
                    <TaskStatusChip status={status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell"><PriorityChip priority={t.priority} /></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {health.key === "finished" || health.key === "no_date" ? (
                      <span className="text-muted-foreground text-sm">{t.due_date ? formatDue(t.due_date, t.due_time) : "No due date"}</span>
                    ) : (
                      <span className="flex flex-col items-end gap-0.5">
                        <HealthChip health={health} />
                        <span className="text-muted-foreground text-xs">{formatDue(t.due_date, t.due_time)}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canAct && (
                      <span className="flex justify-end gap-2">
                        {t.status === "todo" && <TaskStatusButton id={t.id} title={t.title} status="doing" label="Start" />}
                        <TaskStatusButton id={t.id} title={t.title} />
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Pager page={p.page} pages={pages} total={total} noun={["task", "tasks"]} href={(page) => href({ page })} />
      </div>
    </>
  );
}
