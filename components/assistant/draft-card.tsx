"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRightIcon, BuildingIcon, CalendarIcon, CheckIcon, CircleAlertIcon, ClockIcon, FlagIcon, Loader2Icon, UserIcon, UsersIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { confirmAiAction, discardAiAction } from "@/lib/actions/assistant";
import type { DraftCard, TaskPreview } from "@/lib/ai/types";
import { TONE_CHIP, type Tone } from "@/lib/tone";
import { cn } from "cn";

const KIND_LABEL: Record<string, string> = {
  create_task: "New task",
  create_subtasks: "New subtasks",
  update_task: "Edit task",
  set_schedule: "Change dates",
  change_status: "Change status",
  assign_task: "Assign",
  add_comment: "Comment",
  schedule_meeting: "New meeting",
  update_meeting: "Change meeting",
  cancel_meeting: "Cancel meeting",
  rsvp_meeting: "Your answer",
  create_event: "New event",
  update_event: "Change event",
  set_event_team: "Event team",
  event_status: "Event status",
  toggle_run_item: "Run sheet",
  log_activity: "Log outreach",
  create_deal: "New deal",
  update_deal: "Change deal",
  move_deal: "Move deal",
};

const CONFIRM_LABEL: Record<string, string> = {
  create_task: "Create task",
  create_subtasks: "Add subtasks",
  schedule_meeting: "Schedule meeting",
  update_meeting: "Save changes",
  cancel_meeting: "Cancel meeting",
  rsvp_meeting: "Send answer",
  create_event: "Create event",
  update_event: "Save changes",
  set_event_team: "Save team",
  event_status: "Confirm",
  toggle_run_item: "Update run sheet",
  log_activity: "Log activity",
  create_deal: "Create deal",
  update_deal: "Save changes",
  move_deal: "Move deal",
};

function RowsBody({ draft }: { draft: DraftCard }) {
  return (
    <div className="px-3.5 pb-2">
      <p className="py-1 leading-snug font-medium break-words">{draft.summary}</p>
      <dl className="divide-y">
        {draft.rows.map((r) => (
          <div key={r.label} className="flex items-start gap-2.5 py-1.5">
            <dt className="text-muted-foreground w-24 shrink-0">{r.label}</dt>
            <dd className="min-w-0 flex-1 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const PRIORITY: Record<number, { label: string; tone: Tone }> = {
  1: { label: "Urgent", tone: "red" },
  2: { label: "High", tone: "amber" },
  3: { label: "Normal", tone: "slate" },
  4: { label: "Low", tone: "slate" },
};

type View = { label: string; tone: Tone; accent: string; icon: typeof CheckIcon };

function viewOf(d: DraftCard): View {
  if (d.status === "done") return { label: "Done", tone: "green", accent: "border-l-emerald-500", icon: CheckIcon };
  if (d.status === "failed") return { label: "Failed", tone: "red", accent: "border-l-red-500", icon: CircleAlertIcon };
  if (d.status === "running") return { label: "Running", tone: "blue", accent: "border-l-blue-500", icon: Loader2Icon };
  if (d.status === "cancelled") return { label: "Discarded", tone: "slate", accent: "border-l-slate-400", icon: XIcon };
  if (d.expired) return { label: "Expired", tone: "slate", accent: "border-l-slate-400", icon: ClockIcon };
  return { label: "Needs your OK", tone: "amber", accent: "border-l-amber-500", icon: ClockIcon };
}

function Row({ icon: Icon, label, children }: { icon: typeof CheckIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

function TaskBody({ task }: { task: TaskPreview }) {
  const p = PRIORITY[task.priority] ?? { label: "Normal", tone: "slate" as const };
  const who = task.assignees.length === 0 ? "Team queue (nobody yet)" : task.assignees.join(", ");
  return (
    <div className="px-3.5 pb-3">
      <h3 className="py-1 text-base leading-snug font-semibold break-words">{task.title}</h3>
      <div className="divide-y">
        <Row icon={task.assignees.length > 1 ? UsersIcon : UserIcon} label={task.shared ? "Shared by" : "For"}>
          {who}
        </Row>
        <Row icon={CalendarIcon} label="Due">
          {task.dueLabel ?? <span className="text-muted-foreground">No due date</span>}
        </Row>
        <Row icon={FlagIcon} label="Priority">
          <Badge variant="outline" className={cn("h-5 px-2", TONE_CHIP[p.tone])}>
            {p.label}
          </Badge>
        </Row>
        {task.department && (
          <Row icon={BuildingIcon} label="Department">
            <span className="capitalize">{task.department}</span>
          </Row>
        )}
      </div>
      {task.description && <p className="text-muted-foreground mt-2 line-clamp-4 text-sm break-words whitespace-pre-line">{task.description}</p>}
      {task.parent && <p className="text-muted-foreground mt-2 text-xs">This will be a subtask.</p>}
    </div>
  );
}

/** A change the assistant proposes. Nothing happens until the button is pressed (or the person replies "create"). */
export function DraftCardView({ draft, onChange, onStale }: { draft: DraftCard; onChange: (d: DraftCard) => void; onStale: () => void }) {
  const [busy, setBusy] = useState<"confirm" | "discard" | null>(null);

  async function run(which: "confirm" | "discard") {
    setBusy(which);
    const res = await (which === "confirm" ? confirmAiAction({ id: draft.id }) : discardAiAction({ id: draft.id }));
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      onStale();
      return;
    }
    onChange(res.data);
    if (which === "confirm" && res.data.status === "done") toast.success("Done");
  }

  const open = draft.status === "pending" && !draft.expired;
  const retry = draft.status === "failed";
  const view = viewOf(draft);
  const Icon = view.icon;
  const confirmLabel = CONFIRM_LABEL[draft.kind] ?? "Confirm";

  return (
    <div className={cn("bg-card overflow-hidden rounded-xl border border-l-4 text-sm shadow-xs", view.accent)} data-testid="draft-card" data-status={draft.status}>
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{KIND_LABEL[draft.kind] ?? "Change"}</span>
        <Badge variant="outline" className={cn("h-6 gap-1 px-2", TONE_CHIP[view.tone])}>
          <Icon aria-hidden className={cn(draft.status === "running" && "animate-spin")} />
          {view.label}
        </Badge>
      </div>
      {draft.task ? (
        <TaskBody task={draft.task} />
      ) : draft.rows.length > 0 ? (
        <RowsBody draft={draft} />
      ) : (
        <p className="px-3.5 py-2 leading-snug font-medium break-words">{draft.summary}</p>
      )}
      {open && draft.notes.length > 0 && (
        <ul className="text-muted-foreground list-disc space-y-0.5 px-3.5 pb-2 pl-8 text-xs">
          {draft.notes.map((n) => (
            <li key={n} className="break-words">
              {n}
            </li>
          ))}
        </ul>
      )}
      {draft.error && draft.status === "failed" && <p className="text-destructive px-3.5 pb-2 break-words">{draft.error}</p>}
      {draft.expired && draft.status === "pending" && <p className="text-muted-foreground px-3.5 pb-2">This draft is more than a day old. Ask the assistant again.</p>}
      {draft.status === "done" && draft.links.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3">
          {draft.links.map((l) => (
            <Button key={l.href} asChild size="sm" variant="outline" className="h-9 sm:h-8">
              <Link href={l.href}>
                {l.label}
                <ArrowUpRightIcon aria-hidden />
              </Link>
            </Button>
          ))}
        </div>
      )}
      {open && <p className="text-muted-foreground px-3.5 pb-3 text-xs">Nothing has been changed yet. Press {confirmLabel}, or reply “create”.</p>}
      {(open || retry) && (
        <div className="bg-muted/40 flex flex-col gap-2 border-t p-3 sm:flex-row">
          <Button className="h-10 w-full sm:h-9 sm:w-auto" disabled={busy !== null} onClick={() => run("confirm")}>
            {busy === "confirm" ? <Spinner /> : <CheckIcon aria-hidden />} {retry ? "Try again" : confirmLabel}
          </Button>
          {open && (
            <Button className="h-10 w-full sm:h-9 sm:w-auto" variant="outline" disabled={busy !== null} onClick={() => run("discard")}>
              {busy === "discard" ? <Spinner /> : <XIcon aria-hidden />} Discard
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
