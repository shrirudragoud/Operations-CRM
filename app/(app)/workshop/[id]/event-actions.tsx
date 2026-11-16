"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArchiveIcon, ArchiveRestoreIcon, CalendarCheckIcon, CircleCheckIcon, PlayIcon, UndoIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveEvent, cancelEvent, completeEvent, restoreEvent, scheduleEvent, startEvent, unscheduleEvent,
} from "@/lib/actions/event";
import { cancelEventSchema, completeEventSchema, type EventStatus } from "@/lib/schemas/event";

type Props = { id: string; title: string; status: EventStatus; expectedHeadcount: number | null };

/** The moves the database allows from the current status. It re-checks every one and its message is shown as-is. */
export function EventActions({ id, title, status, expectedHeadcount }: Props) {
  const [dialog, setDialog] = useState<"complete" | "cancel" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => ReturnType<typeof scheduleEvent>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) toast.error(res.error);
      else toast.success(success);
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <Button disabled={pending} onClick={() => run(() => scheduleEvent({ id }), "Event scheduled. The cohort code and checklist are ready.")}>
            {pending ? <Spinner /> : <CalendarCheckIcon aria-hidden />} Schedule
          </Button>
        )}
        {status === "scheduled" && (
          <Button disabled={pending} onClick={() => run(() => startEvent({ id }), "Event started")}>
            {pending ? <Spinner /> : <PlayIcon aria-hidden />} Start event
          </Button>
        )}
        {(status === "scheduled" || status === "in_progress") && (
          <Button variant="outline" disabled={pending} onClick={() => setDialog("complete")}>
            <CircleCheckIcon aria-hidden /> Complete
          </Button>
        )}
        {status === "scheduled" && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => unscheduleEvent({ id }), "Moved back to draft")}>
            <UndoIcon aria-hidden /> Back to draft
          </Button>
        )}
        {(status === "draft" || status === "scheduled" || status === "in_progress") && (
          <Button variant="outline" disabled={pending} onClick={() => setDialog("cancel")}>
            <XIcon aria-hidden /> Cancel event
          </Button>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          {dialog === "complete" && <CompleteForm id={id} title={title} expected={expectedHeadcount} onDone={() => setDialog(null)} />}
          {dialog === "cancel" && <CancelForm id={id} title={title} onDone={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CompleteForm({ id, title, expected, onDone }: { id: string; title: string; expected: number | null; onDone: () => void }) {
  const [headcount, setHeadcount] = useState(expected === null ? "" : String(expected));
  const [score, setScore] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const input = { id, actual_headcount: headcount, satisfaction_score: score };
    const parsed = completeEventSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await completeEvent(input);
      if (!res.ok) {
        setServerError(res.error);
        return;
      }
      toast.success("Event completed", { description: "Follow-up tasks were created and the institution moved to Workshop delivered." });
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>Complete this event?</DialogTitle>
        <DialogDescription>{title}. This creates the follow-up tasks. All checklist items before and on the day must be done.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!errors.actual_headcount}>
        <FieldLabel htmlFor="complete-headcount">Students who attended</FieldLabel>
        <Input id="complete-headcount" inputMode="numeric" autoComplete="off" value={headcount} onChange={(e) => setHeadcount(e.target.value)} aria-invalid={!!errors.actual_headcount} />
        <FieldError errors={errors.actual_headcount ? [{ message: errors.actual_headcount }] : undefined} />
      </Field>
      <Field data-invalid={!!errors.satisfaction_score}>
        <FieldLabel htmlFor="complete-score">Satisfaction (0 to 5, optional)</FieldLabel>
        <Input id="complete-score" inputMode="decimal" autoComplete="off" value={score} onChange={(e) => setScore(e.target.value)} aria-invalid={!!errors.satisfaction_score} />
        <FieldDescription>From the college or teacher feedback, if you have it yet.</FieldDescription>
        <FieldError errors={errors.satisfaction_score ? [{ message: errors.satisfaction_score }] : undefined} />
      </Field>
      {serverError && (
        <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Not yet</Button>
        <Button type="submit" disabled={pending}>{pending && <Spinner />} Complete event</Button>
      </DialogFooter>
    </form>
  );
}

function CancelForm({ id, title, onDone }: { id: string; title: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const parsed = cancelEventSchema.safeParse({ id, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Say why the event is cancelled.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await cancelEvent({ id, reason });
      if (!res.ok) {
        setServerError(res.error);
        return;
      }
      toast.success("Event cancelled", { description: "Reserved kits are released." });
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>Cancel this event?</DialogTitle>
        <DialogDescription>{title}. A cancelled event cannot be reopened. Create a new one if the date comes back.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="cancel-reason">Why is it cancelled?</FieldLabel>
        <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} />
        <FieldError errors={error ? [{ message: error }] : undefined} />
      </Field>
      {serverError && (
        <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Keep event</Button>
        <Button type="submit" variant="destructive" disabled={pending}>{pending && <Spinner />} Cancel event</Button>
      </DialogFooter>
    </form>
  );
}

export function EventArchiveButton({ id, title, archived }: { id: string; title: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = archived ? await restoreEvent({ id }) : await archiveEvent({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(archived ? "Event restored" : "Event archived");
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setError(null); setOpen(true); }}>
        {archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />} {archived ? "Restore" : "Archive"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archived ? `Restore ${title}?` : `Archive ${title}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "It comes back onto the calendar and lists. Nothing was deleted."
                : "It leaves the calendar and lists but its history stays. A scheduled or running event must be completed or cancelled first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); toggle(); }}>
              {pending && <Spinner />} {archived ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
