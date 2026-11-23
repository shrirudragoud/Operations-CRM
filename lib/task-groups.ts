import type { TaskStatus } from "@/lib/schemas/activity";
import { taskHealth, type Health, type HealthTask } from "@/lib/task-health";

// One task given to several people is one row per person that shares a group_id. These helpers fold the copies
// a viewer can see into one entry for the Board and the Table. Pure, so they are the same everywhere.

export type TaskCluster<T> = { lead: T; copies: T[] };

/** group_id -> how many copies are done out of how many exist, whoever can see them. Filled from ops.task_group_progress once that view lands (migration 0038); until then nothing is passed and a lone copy only shows the "Shared" chip. */
export type GroupTotals = Map<string, { done: number; total: number }>;

/** SLOT: the Tasks page passes this to the Board and the Table. Replace it with the rows of ops.task_group_progress when migration 0038 lands. */
export const NO_GROUP_TOTALS: GroupTotals = new Map();

type Copy = { id: string; group_id?: string | null; assignee_id?: string | null };

/** Rows in their original order, with visible copies of one group folded into the place of the first. The lead is the viewer's own copy when there is one. */
export function clusterCopies<T extends Copy>(rows: T[], meId?: string): TaskCluster<T>[] {
  const out: TaskCluster<T>[] = [];
  const byGroup = new Map<string, TaskCluster<T>>();
  for (const row of rows) {
    const key = row.group_id;
    if (!key) {
      out.push({ lead: row, copies: [row] });
      continue;
    }
    const known = byGroup.get(key);
    if (known) {
      known.copies.push(row);
      if (meId && row.assignee_id === meId) known.lead = row;
      continue;
    }
    const fresh = { lead: row, copies: [row] };
    byGroup.set(key, fresh);
    out.push(fresh);
  }
  return out;
}

/** Where the folded card sits on the Board: finished only when every live copy is, blocked as soon as one is, in progress once anyone has begun. */
export function clusterStatus(statuses: string[]): TaskStatus {
  const live = statuses.filter((s) => s !== "cancelled");
  if (live.length === 0) return "cancelled";
  if (live.every((s) => s === "done")) return "done";
  if (live.includes("blocked")) return "blocked";
  if (live.includes("doing") || live.includes("done")) return "doing";
  return "todo";
}

/** "N of M done": cancelled copies are not owed, so they leave both numbers. */
export function clusterProgress(statuses: string[]): { done: number; total: number } {
  const live = statuses.filter((s) => s !== "cancelled");
  return { done: live.filter((s) => s === "done").length, total: live.length };
}

/** The most worrying health among the copies. */
export function clusterHealth(copies: HealthTask[], now: Date = new Date()): Health {
  let worst = taskHealth(copies[0] as HealthTask, now);
  for (const c of copies.slice(1)) {
    const h = taskHealth(c, now);
    if (h.rank > worst.rank) worst = h;
  }
  return worst;
}
