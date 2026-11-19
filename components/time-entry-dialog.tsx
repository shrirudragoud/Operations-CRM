"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { DateField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addTimeEntry, updateTimeEntry } from "@/lib/actions/time";

export type TaskOption = { id: string; title: string };

export type EntryDraft = {
  /** Set when editing an existing entry. */
  id?: string;
  taskId: string;
  workDate: string;
  /** Text such as "1h 30m"; empty for a new entry. */
  length: string;
  note: string;
  /** A timed entry keeps its time; only the note can change. */
  timed?: boolean;
};

type FormValues = { task_id: string; work_date: string; minutes: string; note: string };

/**
 * Add or edit a manual time entry. The database re-checks everything (the day window, the 24-hour cap, who may
 * edit); its message is shown as it is. Pass `tasks` to let the person choose the task, or a fixed `draft.taskId`.
 */
export function TimeEntryDialog({
  open, onOpenChange, draft, tasks, today,
}: { open: boolean; onOpenChange: (open: boolean) => void; draft: EntryDraft; tasks?: TaskOption[]; today: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <EntryForm draft={draft} tasks={tasks} today={today} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ draft, tasks, today, onDone }: { draft: EntryDraft; tasks?: TaskOption[]; today: string; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = !!draft.id;
  const form = useForm<FormValues>({
    defaultValues: { task_id: draft.taskId, work_date: draft.workDate, minutes: draft.length, note: draft.note },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: FormValues) {
    setServerError(null);
    const res = draft.id
      ? await updateTimeEntry({ id: draft.id, work_date: v.work_date, minutes: v.minutes, note: v.note })
      : await addTimeEntry({ task_id: v.task_id, work_date: v.work_date, minutes: v.minutes, note: v.note });
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof FormValues, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success(editing ? "Time updated" : "Time logged");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit time" : "Log time"}</DialogTitle>
        <DialogDescription>
          {draft.timed ? "This entry came from a timer, so its time is fixed. You can change the note." : "Time you spent on the task, entered by hand."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {tasks && !editing && (
          <Field data-invalid={!!errors.task_id}>
            <FieldLabel htmlFor="time-task">Task</FieldLabel>
            <Controller
              control={form.control}
              name="task_id"
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="time-task" className="w-full" aria-invalid={!!errors.task_id}><SelectValue placeholder="Choose a task" /></SelectTrigger>
                  <SelectContent>
                    {tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>Not in the list? Open the task and log time from its page.</FieldDescription>
            <FieldError errors={[errors.task_id]} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.work_date}>
            <FieldLabel htmlFor="time-date">Day</FieldLabel>
            <Controller control={form.control} name="work_date" render={({ field }) => <DateField id="time-date" value={field.value} onChange={field.onChange} max={today} disabled={draft.timed} invalid={!!errors.work_date} />} />
            <FieldError errors={[errors.work_date]} />
          </Field>
          <Field data-invalid={!!errors.minutes}>
            <FieldLabel htmlFor="time-length">How long</FieldLabel>
            <Input id="time-length" autoComplete="off" placeholder="1h 30m" readOnly={draft.timed} aria-invalid={!!errors.minutes} {...form.register("minutes")} />
            <FieldError errors={[errors.minutes]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.note}>
          <FieldLabel htmlFor="time-note">Note (optional)</FieldLabel>
          <Textarea id="time-note" rows={2} aria-invalid={!!errors.note} {...form.register("note")} />
          <FieldError errors={[errors.note]} />
        </Field>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} {editing ? "Save" : "Log time"}</Button>
      </DialogFooter>
    </form>
  );
}
