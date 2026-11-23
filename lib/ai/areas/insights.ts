// Insights: how task delivery is going (on time, late, backlog) for the founder and department leads. Reads only.
// Uses the same numbers and the same scope rules as the Cockpit's Operations view: a lead only ever sees their own team.

import type { FunctionDeclaration } from "@/lib/ai/gemini";
import type { AreaModule } from "@/lib/ai/registry";
import type { ToolEnv, ToolResult } from "@/lib/ai/tools";
import { dayArg } from "@/lib/ai/when";
import { buildScope, formatPercent, inScope, isOpen, PERIODS, peopleTable, periodRange, summarize, type Period, type TaskRow } from "@/lib/ops-insight";
import { canAccess, DEPARTMENTS } from "@/lib/permissions";
import { visiblePeople } from "@/lib/workload";

export type InsightsEnv = {
  /** Tasks finished or created since `since`, and every open task, already limited by what the person may see. */
  taskRows(since: string): Promise<{ rows: TaskRow[]; truncated: boolean }>;
};

const MAX_PEOPLE = 15;
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

const declarations: FunctionDeclaration[] = [
  {
    name: "ops_summary",
    description:
      "How task delivery is going for a period: tasks finished early, on time and late, the on-time rate against the previous period, what is open and overdue now, and per person. For the founder and department leads. Use for 'how are we doing this week', 'who has the most overdue work'.",
    parameters: {
      type: "object",
      properties: {
        period: str("today, week (the default) or month.", { enum: [...PERIODS] }),
        on: str("A day inside the period. A date as YYYY-MM-DD (India time). Defaults to today."),
        department: str("Only this department.", { enum: [...DEPARTMENTS] }),
        person_id: str("Only this person, from find_people."),
      },
    },
  },
];

const minutesText = (m: number) => (m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`);

async function opsSummary(env: ToolEnv, args: Record<string, unknown>): Promise<ToolResult> {
  const period: Period = PERIODS.find((p) => p === args.period) ?? "week";
  const on = args.on === undefined ? env.today : dayArg(args.on);
  if (!on) return { error: "on must be a real day as YYYY-MM-DD." };
  const department = DEPARTMENTS.find((d) => d === args.department) ?? null;
  const person = typeof args.person_id === "string" ? args.person_id : null;

  const range = periodRange(period, on);
  const roster = await env.people();
  const visible = visiblePeople(roster.map((p) => ({ ...p, departments: p.departments })), env.me);
  const scope = buildScope(env.me, visible, { department, person });
  const { rows: all, truncated } = await env.insights.taskRows(range.prevFrom);
  const rows = all.filter((t) => inScope(t, scope));

  const cur = summarize(rows, range.from, range.to);
  const prev = summarize(rows, range.prevFrom, range.prevTo);
  const open = rows.filter(isOpen);
  const people = peopleTable(rows, visible.filter((p) => (!scope.person || p.id === scope.person) && (!scope.department || p.departments.includes(scope.department))), range.from, range.to, env.today)
    .filter((p) => p.done > 0 || p.openNow > 0)
    .sort((a, b) => b.overdueNow - a.overdueNow || b.openNow - a.openNow)
    .slice(0, MAX_PEOPLE);

  return {
    period: range.label,
    compared_with: range.prevLabel,
    scope: env.me.role === "founder" ? "everyone" : "your team",
    ...(truncated ? { note: "There was too much data to read all of it; the numbers may be a little low." } : {}),
    finished: { total: cur.done, early: cur.early, on_time: cur.onTime, late: cur.late, no_deadline: cur.noDeadline, on_time_rate: formatPercent(cur.onTimeRate), of_tasks_with_a_deadline: cur.withDeadline },
    previous_period: { finished: prev.done, on_time_rate: formatPercent(prev.onTimeRate), late: prev.late },
    created: cur.created,
    ...(cur.avgDaysLate !== null ? { average_days_late: cur.avgDaysLate } : {}),
    time_logged: minutesText(cur.loggedMinutes),
    open_now: {
      total: open.length,
      overdue: open.filter((t) => t.due_date !== null && t.due_date < env.today).length,
      blocked: open.filter((t) => t.status === "blocked").length,
      no_deadline: open.filter((t) => t.due_date === null).length,
    },
    people: people.map((p) => ({ name: p.name, finished: p.done, late: p.late, open: p.openNow, overdue: p.overdueNow })),
  };
}

export const insightsArea: AreaModule = {
  id: "insights",
  allowed: (me) => canAccess(me, "cockpit"),
  declarations,
  run: async (env, name, rawArgs) => {
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
    try {
      if (name === "ops_summary") return await opsSummary(env, args);
      return { error: `There is no tool called ${name}.` };
    } catch (e) {
      console.error(JSON.stringify({ level: "error", context: "assistantTool", tool: name, message: e instanceof Error ? e.message : String(e) }));
      return { error: "That lookup failed. Try again, or tell the person you could not do it." };
    }
  },
  prompt: [
    "Insights",
    "- ops_summary shows how task delivery is going for a period. Say the on-time rate with how many tasks it is based on. Do not use it to judge a person; give the facts.",
  ],
};
