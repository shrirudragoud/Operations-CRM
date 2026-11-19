import {
  AlarmClockIcon, ArrowDownIcon, BadgeCheckIcon, CircleAlertIcon, HourglassIcon, TriangleAlertIcon, BanIcon, PhoneOffIcon, RotateCwIcon, ThumbsDownIcon, ThumbsUpIcon, CalendarClockIcon, CheckCircle2Icon, ChevronsUpIcon, CircleDashedIcon, FlameIcon, MinusIcon, PlayCircleIcon,
  XCircleIcon, type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { DEPARTMENT_LABELS, type Department } from "@/lib/permissions";
import { OUTCOME_LABELS, TASK_STATUS_LABELS, type Outcome, type TaskStatus } from "@/lib/schemas/activity";
import { PRIORITY_LABELS, type Priority } from "@/lib/schemas/task";
import type { Health, HealthKey } from "@/lib/task-health";
import {
  DEPARTMENT_TONE, DUE_TONE, OUTCOME_TONE, PRIORITY_TONE, TASK_STATUS_TONE, TONE_CHIP, type DueState, type Tone,
} from "@/lib/tone";

/** A small coloured pill. The label always carries the meaning; colour and icon are extra. */
export function Chip({ tone, icon: Icon, children, className, title }: { tone: Tone; icon?: LucideIcon; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap [&>svg]:size-3", TONE_CHIP[tone], className)}
    >
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  );
}

const PRIORITY_ICON: Record<number, LucideIcon> = { 1: FlameIcon, 2: ChevronsUpIcon, 3: MinusIcon, 4: ArrowDownIcon };

export function PriorityChip({ priority, className }: { priority: number; className?: string }) {
  const p = priority as Priority;
  return <Chip tone={PRIORITY_TONE[priority] ?? "slate"} icon={PRIORITY_ICON[priority] ?? MinusIcon} className={className}>{PRIORITY_LABELS[p] ?? String(priority)}</Chip>;
}

export const STATUS_ICON: Record<string, LucideIcon> = {
  todo: CircleDashedIcon, doing: PlayCircleIcon, blocked: BanIcon, done: CheckCircle2Icon, cancelled: XCircleIcon,
};

export function TaskStatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <Chip tone={TASK_STATUS_TONE[status] ?? "slate"} icon={STATUS_ICON[status] ?? CircleDashedIcon} className={className}>
      {TASK_STATUS_LABELS[status as TaskStatus] ?? status}
    </Chip>
  );
}

/** Deadline pill: red when overdue, amber today, blue within three days, grey later. */
export function DueChip({ state, label, className }: { state: DueState; label: string; className?: string }) {
  return <Chip tone={DUE_TONE[state]} icon={CalendarClockIcon} className={className}>{label}</Chip>;
}

const HEALTH_ICON: Record<HealthKey, LucideIcon> = {
  overdue: AlarmClockIcon, at_risk: TriangleAlertIcon, due_today: CircleAlertIcon, soon: HourglassIcon,
  on_track: CheckCircle2Icon, later: CalendarClockIcon, no_date: CalendarClockIcon, finished: CheckCircle2Icon,
};

/** Task health pill (D48): the colour climbs from blue to amber to orange as the deadline closes in, then red once late. The tooltip lists the reasons. */
export function HealthChip({ health, label, className }: { health: Health; label?: string; className?: string }) {
  return (
    <Chip tone={health.tone} icon={HEALTH_ICON[health.key]} title={health.detail} className={className}>
      {label ?? health.label}
    </Chip>
  );
}

export function DepartmentChip({ department, className }: { department: string | null; className?: string }) {
  if (!department) return <Chip tone="slate" className={className}>No department</Chip>;
  return <Chip tone={DEPARTMENT_TONE[department] ?? "slate"} className={className}>{DEPARTMENT_LABELS[department as Department] ?? department}</Chip>;
}

const OUTCOME_ICON: Record<string, LucideIcon> = {
  no_answer: PhoneOffIcon, interested: ThumbsUpIcon, not_interested: ThumbsDownIcon, follow_up: RotateCwIcon, qualified: BadgeCheckIcon,
};

/** The result of an outreach activity: green for interest, amber for follow up, red for a no, violet when qualified. */
export function OutcomeChip({ outcome, className }: { outcome: string; className?: string }) {
  return (
    <Chip tone={OUTCOME_TONE[outcome] ?? "slate"} icon={OUTCOME_ICON[outcome]} className={className}>
      {OUTCOME_LABELS[outcome as Outcome] ?? outcome}
    </Chip>
  );
}
