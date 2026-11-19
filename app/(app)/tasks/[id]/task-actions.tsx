"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, HandIcon, PlayIcon, UndoIcon, XIcon, BanIcon, ThumbsUpIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { acceptTask, assignTask, changeTaskStatus, deleteTask } from "@/lib/actions/task";
import type { TaskStatus } from "@/lib/schemas/activity";
import { allowedTaskMoves } from "@/lib/schemas/task";

export type TaskActionFlags = {
  canMove: boolean;
  canReopen: boolean;
  canAccept: boolean;
  canClaim: boolean;
  canDecline: boolean;
  canDelete: boolean;
};

type Props = { id: string; meId: string; title: string; status: TaskStatus; flags: TaskActionFlags; onDeletedHref?: string };

/** The moves the database allows from the current status. It re-checks every one and its message is shown as-is. */
export function TaskActions({ id, meId, title, status, flags, onDeletedHref = "/tasks" }: Props) {
  const [reasonFor, setReasonFor] = useState<"blocked" | "cancelled" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const moves = allowedTaskMoves(status);
  const finished = status === "done" || status === "cancelled";

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) toast.error(res.error);
      else toast.success(success);
    });
  }
  const move = (to: TaskStatus, success: string) => run(() => changeTaskStatus({ id, status: to }), success);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {flags.canAccept && (
          <Button disabled={pending} onClick={() => run(() => acceptTask({ id }), "Accepted")}>
            {pending ? <Spinner /> : <ThumbsUpIcon aria-hidden />} Accept
          </Button>
        )}
        {flags.canClaim && (
          <Button disabled={pending} onClick={() => run(() => assignTask({ id, assignee_id: meId }), "It is yours now")}>
            <HandIcon aria-hidden /> Take it
          </Button>
        )}
        {flags.canMove && !finished && (
          <>
            {moves.includes("doing") && status !== "doing" && (
              <Button disabled={pending} onClick={() => move("doing", status === "blocked" ? "Unblocked" : "Started")}>
                <PlayIcon aria-hidden /> {status === "blocked" ? "Unblock" : "Start"}
              </Button>
            )}
            {status === "doing" && (
              <Button variant="outline" disabled={pending} onClick={() => move("todo", "Moved back to to do")}>
                <UndoIcon aria-hidden /> Back to to do
              </Button>
            )}
            <Button disabled={pending} variant={status === "doing" ? "default" : "outline"} onClick={() => move("done", "Marked done")}>
              <CheckIcon aria-hidden /> Done
            </Button>
            {status !== "blocked" && (
              <Button variant="outline" disabled={pending} onClick={() => setReasonFor("blocked")}>
                <BanIcon aria-hidden /> Blocked
              </Button>
            )}
            <Button variant="outline" disabled={pending} onClick={() => setReasonFor("cancelled")}>
              <XIcon aria-hidden /> Cancel task
            </Button>
          </>
        )}
        {finished && flags.canReopen && (
          <Button variant="outline" disabled={pending} onClick={() => move("todo", "Reopened")}>
            <UndoIcon aria-hidden /> Reopen
          </Button>
        )}
        {flags.canDecline && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => assignTask({ id, assignee_id: null }), "Handed back to the queue")}>
            Hand back
          </Button>
        )}
        {flags.canDelete && (
          <Button variant="ghost" disabled={pending} onClick={() => setConfirmDelete(true)}>
            <Trash2Icon aria-hidden /> Delete
          </Button>
        )}
      </div>

      <Dialog open={reasonFor !== null} onOpenChange={(o) => !o && setReasonFor(null)}>
        <DialogContent className="sm:max-w-md">
          {reasonFor && <ReasonForm id={id} title={title} to={reasonFor} onDone={() => setReasonFor(null)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; and its subtasks, comments and history are removed for good. To keep a record, cancel it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const res = await deleteTask({ id });
                  if (!res.ok) toast.error(res.error);
                  else {
                    toast.success("Task deleted");
                    window.location.assign(onDeletedHref);
                  }
                });
              }}
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReasonForm({ id, title, to, onDone }: { id: string; title: string; to: "blocked" | "cancelled"; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocked = to === "blocked";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = await changeTaskStatus({ id, status: to, reason });
      if (!res.ok) {
        const msg = res.fieldErrors?.reason?.[0];
        if (msg) setFieldError(msg);
        else setError(res.error);
        return;
      }
      toast.success(blocked ? "Marked as blocked" : "Task cancelled");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>{blocked ? "What is blocking it?" : "Why is it cancelled?"}</DialogTitle>
        <DialogDescription>{title}</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!fieldError}>
        <FieldLabel htmlFor="task-reason">{blocked ? "Blocked because" : "Reason"}</FieldLabel>
        <Textarea id="task-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!fieldError} />
        <FieldError errors={fieldError ? [{ message: fieldError }] : []} />
      </Field>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Back</Button>
        <Button type="submit" disabled={pending}>{pending && <Spinner />} {blocked ? "Mark blocked" : "Cancel task"}</Button>
      </DialogFooter>
    </form>
  );
}
