import { taskHealth, type HealthTask } from "@/lib/task-health";
import { PRIORITY_TONE, TASK_STATUS_TONE, TONE_CHIP } from "@/lib/tone";

type Chipped = HealthTask & { priority?: number };

/** Calendar and timeline bars use task health (D48): red when late, orange / amber / blue as the deadline closes in, blocked red, doing blue, done green, otherwise by priority. */
export function chipClass(t: Chipped): string {
  if (t.status === "cancelled") return `${TONE_CHIP.slate} line-through opacity-70`;
  if (t.status === "done") return `${TONE_CHIP.green} opacity-80`;
  if (t.status === "blocked") return TONE_CHIP.red;
  const h = taskHealth(t);
  if (h.level > 0) return TONE_CHIP[h.tone];
  if (t.status === "doing") return TONE_CHIP.blue;
  return TONE_CHIP[PRIORITY_TONE[t.priority ?? 3] ?? TASK_STATUS_TONE.todo ?? "slate"];
}

/** " Overdue 2 d." / " At risk · tomorrow. Not started." for a tooltip or screen reader; empty when the task is fine. */
export function healthNote(t: HealthTask): string {
  const h = taskHealth(t);
  return h.level > 0 ? ` ${h.label}. ${h.reasons.length ? `${h.reasons.join(". ")}.` : ""}` : "";
}
