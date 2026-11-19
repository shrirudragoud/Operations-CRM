import type { ReactNode } from "react";
import { canScheduleTask, type Me } from "@/lib/permissions";
import type { CardExtras, TaskRow } from "@/lib/queries/tasks";
import type { TaskStatus } from "@/lib/schemas/activity";
import { formatSpan, type TaskView } from "@/lib/schemas/task";
import { taskHealth } from "@/lib/task-health";
import { BoardColumns, type BoardCard } from "./board-columns";

// Columns follow the Show filter: Open = To do / In progress / Blocked / Done (recent), Finished = Done / Cancelled, All = every column.
const COLUMNS: Record<TaskView, TaskStatus[]> = {
  open: ["todo", "doing", "blocked", "done"],
  done: ["done", "cancelled"],
  all: ["todo", "doing", "blocked", "done", "cancelled"],
};

const NO_EXTRAS: CardExtras = { subOpen: 0, subTotal: 0, watchers: 0, comments: 0, logged: 0 };

export function TaskBoard({ me, tasks, view, extras, create }: {
  me: Me; tasks: TaskRow[]; view: TaskView; extras: Map<string, CardExtras>; create?: ReactNode;
}) {
  const now = new Date();
  const cards: BoardCard[] = tasks.map((t) => {
    const e = extras.get(t.id) ?? NO_EXTRAS;
    return {
      id: t.id,
      title: t.title,
      status: t.status as TaskStatus,
      priority: t.priority,
      department: t.department,
      assignee: t.assignee?.full_name ?? null,
      health: taskHealth({ ...t, subOpen: e.subOpen }, now),
      span: formatSpan(t.start_date, t.due_date, t.due_time),
      hasDates: !!(t.start_date || t.due_date),
      estimate: t.estimate_minutes,
      movable: canScheduleTask(me, t),
      ...e,
    };
  });
  return <BoardColumns cards={cards} columns={COLUMNS[view]} recentDone={view === "open"} create={create} />;
}
