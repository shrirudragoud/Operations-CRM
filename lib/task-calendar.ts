import { formatDate, todayIST } from "@/lib/format";
import { addDays, allDayRange, clockLabel, type CalItem } from "@/lib/schemas/calendar";
import { daysBetween, LEAD_DAYS, taskHealth, type HealthTask } from "@/lib/task-health";

// A task on the calendar (D48). Besides the deadline itself, an open task shows a dashed reminder on each of the
// LEAD_DAYS days before it, and an overdue one is carried onto today, so work due on the 12th is visible, and
// colour-coded, on the 9th, 10th and 11th. Pure: the query layer only fetches rows.

export type CalendarTask = HealthTask & {
  id: string;
  title: string;
  department: string | null;
  due_date: string | null;
};

const OPEN = new Set(["todo", "doing", "blocked"]);

/** Noon IST on a day: "what will this task look like then, if nothing changes". */
const noonIST = (day: string) => new Date(`${day}T12:00:00+05:30`);

function base(t: CalendarTask, day: string): Omit<CalItem, "key" | "when" | "health" | "reminder"> {
  return {
    source: "task",
    group: "task",
    id: t.id,
    href: `/tasks/${t.id}`,
    title: t.title,
    ...allDayRange(day),
    allDay: true,
    kind: "task",
    kindLabel: "Task",
    department: t.department,
    status: t.status,
    pending: false,
    needsMe: false,
    done: t.status === "done",
    place: null,
    recurring: false,
    people: 0,
    institution: null,
    role: null,
  };
}

/** Items for one task inside the window [fromDay, toDay): the deadline, the lead-up reminders and the overdue carry-forward. */
export function taskCalendarItems(t: CalendarTask, win: { fromDay: string; toDay: string; now?: Date }): CalItem[] {
  if (!t.due_date) return [];
  const now = win.now ?? new Date();
  const today = todayIST(now);
  const inView = (day: string) => day >= win.fromDay && day < win.toDay;
  const out: CalItem[] = [];

  if (inView(t.due_date)) {
    out.push({
      ...base(t, t.due_date),
      key: `t:${t.id}`,
      when: t.due_time ? `Due ${clockLabel(t.due_time.slice(0, 5))}` : "Due",
      health: taskHealth(t, now),
      reminder: false,
    });
  }
  if (!OPEN.has(t.status)) return out;

  for (let n = LEAD_DAYS; n >= 1; n -= 1) {
    const day = addDays(t.due_date, -n);
    if (day < today || !inView(day)) continue;
    const health = taskHealth(t, noonIST(day));
    out.push({
      ...base(t, day),
      key: `t:${t.id}:r:${day}`,
      when: n === 1 ? "Due tomorrow" : `Due in ${n} days`,
      health,
      reminder: true,
    });
  }

  if (t.due_date < today && inView(today)) {
    const health = taskHealth(t, now);
    out.push({
      ...base(t, today),
      key: `t:${t.id}:c`,
      when: `Was due ${formatDate(t.due_date)}`,
      health: { ...health, label: `Overdue ${daysBetween(t.due_date, today)} d` },
      reminder: true,
    });
  }
  return out;
}
