import type { ReactNode } from "react";
import { canScheduleTask, type Me } from "@/lib/permissions";
import type { CardExtras, OwnerRow, TaskRow } from "@/lib/queries/tasks";
import type { TaskStatus } from "@/lib/schemas/activity";
import { formatSpan, type TaskView } from "@/lib/schemas/task";
import { clusterCopies, clusterHealth, clusterProgress, clusterStatus, type GroupTotals } from "@/lib/task-groups";
import { taskHealth } from "@/lib/task-health";
import { BoardColumns, type BoardCard } from "./board-columns";

// Columns follow the Show filter: Open = To do / In progress / Blocked / Done (recent), Finished = Done / Cancelled, All = every column.
const COLUMNS: Record<TaskView, TaskStatus[]> = {
  open: ["todo", "doing", "blocked", "done"],
  done: ["done", "cancelled"],
  all: ["todo", "doing", "blocked", "done", "cancelled"],
};

const NO_EXTRAS: CardExtras = { subOpen: 0, subOverdue: 0, subBlocked: 0, subTotal: 0, subs: [], watchers: 0, comments: 0, logged: 0 };

export function TaskBoard({ me, tasks, view, extras, parents, groupTotals, owners, create }: {
  me: Me;
  tasks: TaskRow[];
  view: TaskView;
  extras: Map<string, CardExtras>;
  /** Titles of the parents of any subtask on the board; a parent the viewer cannot read is missing. */
  parents: Map<string, string>;
  /** The whole group's counts (ops.task_group_progress), for a viewer who sees one copy. */
  groupTotals?: GroupTotals;
  /** Owners of the shared tasks on the board, by task id. */
  owners?: Map<string, OwnerRow[]>;
  create?: ReactNode;
}) {
  const now = new Date();
  const cards: BoardCard[] = clusterCopies(tasks, me.id).map(({ lead: t, copies }) => {
    const e = extras.get(t.id) ?? NO_EXTRAS;
    const base = {
      id: t.id,
      title: t.title,
      priority: t.priority,
      department: t.department,
      span: formatSpan(t.start_date, t.due_date, t.due_time),
      hasDates: !!(t.start_date || t.due_date),
      parent: t.parent_task_id && parents.has(t.parent_task_id) ? { id: t.parent_task_id, title: parents.get(t.parent_task_id) ?? "" } : null,
    };

    if (copies.length > 1) {
      const statuses = copies.map((c) => c.status);
      return {
        ...base,
        status: clusterStatus(statuses),
        assignee: null,
        health: clusterHealth(copies, now),
        estimate: null,
        movable: false,
        group: { people: copies.map((c) => c.assignee?.full_name ?? "Unassigned"), ...clusterProgress(statuses) },
        shared: null,
        coOwners: null,
        subOpen: 0, subTotal: 0, subs: [], watchers: 0, comments: 0, logged: 0,
      };
    }

    const totals = t.group_id ? groupTotals?.get(t.group_id) : undefined;
    return {
      ...base,
      status: t.status as TaskStatus,
      assignee: t.assignee?.full_name ?? null,
      health: taskHealth({ ...t, subOpen: e.subOpen, subOverdue: e.subOverdue, subBlocked: e.subBlocked }, now),
      estimate: t.estimate_minutes,
      movable: canScheduleTask(me, t),
      group: null,
      shared: t.group_id ? { progress: totals ?? null } : null,
      coOwners: t.shared ? (owners?.get(t.id) ?? []).map((o) => o.full_name) : null,
      subOpen: e.subOpen, subTotal: e.subTotal, subs: e.subs, watchers: e.watchers, comments: e.comments, logged: e.logged,
    };
  });
  return <BoardColumns cards={cards} columns={COLUMNS[view]} recentDone={view === "open"} create={create} />;
}
