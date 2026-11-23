"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, CircleAlertIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@ui-sdk/react/avatar";
import { Button } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { Input } from "@ui-sdk/react/input";
import { Progress, ProgressIndicator, ProgressTrack } from "@ui-sdk/react/progress";
import { cn } from "cn";
import { TaskStatusChip } from "@/components/chips";
import { PeoplePicker, type PickerPerson } from "@/components/people-picker";
import { changeTaskStatus, createTask } from "@/lib/actions/task";
import { formatDate, initials } from "@/lib/format";
import { formatDue, isOverdue } from "@/lib/schemas/task";

export type SubtaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  assignee: string | null;
  coOwners: string[];
  /** Whether the caller may finish it (or reopen it, when it is done). Computed on the server from the same rules as the database. */
  canToggle: boolean;
};

const isDone = (status: string) => status === "done";

type Props = {
  parentId: string;
  parentDue: string | null;
  department: string | null;
  rows: SubtaskRow[];
  people: PickerPerson[];
  meId: string;
  today: string;
  canAdd: boolean;
};

/** A checklist of a task's steps: tick to finish or reopen, with a progress bar and an inline row to add the next one. */
export function Subtasks({ parentId, parentDue, department, rows, people, meId, today, canAdd }: Props) {
  const [done, setDone] = useOptimistic<Record<string, boolean>, { id: string; on: boolean }>({}, (cur, a) => ({ ...cur, [a.id]: a.on }));
  const [, start] = useTransition();

  // Cancelled steps are not owed, so they leave both numbers.
  const live = rows.filter((r) => r.status !== "cancelled");
  const finished = live.filter((r) => done[r.id] ?? isDone(r.status)).length;

  function toggle(r: SubtaskRow, on: boolean) {
    start(async () => {
      setDone({ id: r.id, on });
      const res = await changeTaskStatus({ id: r.id, status: on ? "done" : "todo", reason: "" });
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {live.length > 0 && (
        <div className="grid gap-1.5">
          <Progress value={Math.round((finished / live.length) * 100)} aria-label="Subtasks done">
            <ProgressTrack className="bg-muted h-1.5 overflow-hidden rounded-full">
              <ProgressIndicator className="bg-primary h-full rounded-full" />
            </ProgressTrack>
          </Progress>
          <p className="text-muted-foreground text-xs">{finished} of {live.length} done</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Break a big task into steps and give each one an owner.</p>
      ) : (
        <ul className="divide-y" aria-label="Subtasks">
          {rows.map((r) => {
            const checked = done[r.id] ?? isDone(r.status);
            const late = !checked && isOverdue(r);
            const afterParent = !!parentDue && !!r.due_date && r.due_date > parentDue;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Checkbox
                  checked={checked}
                  disabled={!r.canToggle || r.status === "cancelled"}
                  onCheckedChange={(on) => toggle(r, on === true)}
                  aria-label={`${checked ? "Reopen" : "Finish"} ${r.title}`}
                >
                  <CheckboxIndicator><CheckIcon aria-hidden="true" /></CheckboxIndicator>
                </Checkbox>
                <Link className={cn("min-w-0 flex-1 text-sm underline-offset-4 hover:underline", checked && "text-muted-foreground line-through")} href={`/tasks/${r.id}`}>
                  {r.title}
                </Link>
                <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  {r.assignee ? (
                    <span className="flex items-center gap-1">
                      <Avatar aria-hidden className="size-6"><AvatarFallback className="text-[10px]">{initials(r.assignee)}</AvatarFallback></Avatar>
                      {r.assignee}
                      {r.coOwners.length > 0 && <span title={r.coOwners.join(", ")}>+{r.coOwners.length} more</span>}
                    </span>
                  ) : "Unassigned"}
                  {r.due_date && <span className={cn(late && "text-destructive font-medium")}>{late ? "Overdue, " : ""}{formatDue(r.due_date, r.due_time)}</span>}
                  <TaskStatusChip status={r.status} />
                </span>
                {afterParent && (
                  <p className="text-destructive flex w-full items-center gap-1 pl-7 text-xs">
                    <CircleAlertIcon aria-hidden className="size-3.5" />
                    Due after the main task ({formatDate(parentDue)}).
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && <AddRow parentId={parentId} parentDue={parentDue} department={department} people={people} meId={meId} today={today} />}
    </div>
  );
}

function AddRow({ parentId, parentDue, department, people, meId, today }: Omit<Props, "rows" | "canAdd">) {
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const after = !!parentDue && !!due && due > parentDue;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Name the subtask first.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await createTask({
        title, department: department ?? "", category: "", assignee_id: who[0] ?? "", also_assignee_ids: who.slice(1), start_date: "", due_date: due, due_time: "",
        priority: "3", estimate_minutes: "", description: "", parent_task_id: parentId, entity_type: null, entity_id: "",
      });
      if (!res.ok) {
        setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.error);
        return;
      }
      toast.success("Subtask added");
      setTitle("");
      setWho([]);
      setDue("");
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-2 border-t pt-3" aria-label="Add a subtask">
      <div className="flex flex-wrap items-start gap-2">
        <Input
          className="min-w-48 flex-1"
          aria-label="Subtask name"
          aria-invalid={!!error}
          placeholder="Next step"
          autoComplete="off"
          value={title}
          onValueChange={setTitle}
        />
        <div className="w-56">
          <PeoplePicker id={`sub-who-${parentId}`} people={people} value={who} onChange={setWho} meId={meId} max={20} placeholder="Who does it" />
        </div>
        <Input className="w-40" type="date" aria-label="Subtask due date" min={today} value={due} onValueChange={setDue} />
        <Button type="submit" disabled={pending} aria-label="Add to subtasks">
          {pending ? <Loader2Icon aria-hidden className="animate-spin" /> : <PlusIcon aria-hidden />} Add
        </Button>
      </div>
      {after && <p className="text-destructive text-xs">This is due after the main task ({formatDate(parentDue)}). You can still add it.</p>}
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
    </form>
  );
}
