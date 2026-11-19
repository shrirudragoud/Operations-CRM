"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { DateField, TimeField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { assignTask, cancelTaskGroup, scheduleTask, updateTask, updateTaskGroup } from "@/lib/actions/task";
import { DEPARTMENTS, DEPARTMENT_LABELS, type Department } from "@/lib/permissions";
import { PRIORITIES, PRIORITY_LABELS, TASK_CATEGORIES, TASK_CATEGORY_LABELS, updateTaskSchema, type TaskCategory, type UpdateTaskInput, type UpdateTaskValues } from "@/lib/schemas/task";

const UNASSIGNED = "unassigned";
const NONE = "none";

export type TaskEditValues = {
  id: string;
  title: string;
  description: string;
  department: Department | "";
  category: TaskCategory | "";
  start_date: string;
  due_date: string;
  due_time: string;
  priority: string;
  estimate_minutes: string;
};

/**
 * Details and schedule. A manager (founder, creator, department lead) edits everything; anyone else who can
 * work on the task changes only the schedule. The database refuses the rest and says why.
 */
export function TaskEditForm({ values, canEditDetails, canSchedule, groupSize = 0, canEditGroup = false }: { values: TaskEditValues; canEditDetails: boolean; canSchedule: boolean; groupSize?: number; canEditGroup?: boolean }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(false);
  const form = useForm<UpdateTaskInput, unknown, UpdateTaskValues>({
    resolver: zodResolver(updateTaskSchema),
    defaultValues: { ...values },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const disabledDetails = !canEditDetails;
  const disabledSchedule = !canSchedule;

  async function onSubmit() {
    setServerError(null);
    const v = form.getValues();
    const res = canEditDetails ? await updateTask(v) : await scheduleTask({
      id: v.id, start_date: v.start_date, due_date: v.due_date, due_time: v.due_time, priority: v.priority, estimate_minutes: v.estimate_minutes,
    });
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof UpdateTaskInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    if (canEditDetails && everyone && canEditGroup && groupSize > 1) {
      const g = await updateTaskGroup({ id: v.id, title: v.title, description: v.description, priority: v.priority, department: v.department, category: v.category });
      if (!g.ok) {
        setServerError(g.error);
        return;
      }
      toast.success(`Saved for ${g.data.updated} open ${g.data.updated === 1 ? "task" : "tasks"} in the group`);
    } else {
      toast.success("Task saved");
    }
    form.reset(form.getValues());
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="edit-title">Title</FieldLabel>
          <Input id="edit-title" autoComplete="off" disabled={disabledDetails} aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="edit-description">Details</FieldLabel>
          <Textarea id="edit-description" rows={4} disabled={disabledDetails} aria-invalid={!!errors.description} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.department}>
            <FieldLabel htmlFor="edit-department">Department</FieldLabel>
            <Controller
              control={form.control}
              name="department"
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} disabled={disabledDetails}>
                  <SelectTrigger id="edit-department" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No department</SelectItem>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.department]} />
          </Field>
          <Field data-invalid={!!errors.category}>
            <FieldLabel htmlFor="edit-category">Category</FieldLabel>
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} disabled={disabledDetails}>
                  <SelectTrigger id="edit-category" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {TASK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.category]} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.start_date}>
            <FieldLabel htmlFor="edit-start-date">Start date</FieldLabel>
            <Controller control={form.control} name="start_date" render={({ field }) => <DateField id="edit-start-date" value={field.value} onChange={field.onChange} disabled={disabledSchedule} invalid={!!errors.start_date} />} />
            <FieldError errors={[errors.start_date]} />
          </Field>
          <Field data-invalid={!!errors.due_date}>
            <FieldLabel htmlFor="edit-due-date">Deadline</FieldLabel>
            <Controller control={form.control} name="due_date" render={({ field }) => <DateField id="edit-due-date" value={field.value} onChange={field.onChange} disabled={disabledSchedule} invalid={!!errors.due_date} />} />
            <FieldError errors={[errors.due_date]} />
          </Field>
          <Field data-invalid={!!errors.due_time}>
            <FieldLabel htmlFor="edit-due-time">Deadline time (India)</FieldLabel>
            <Controller control={form.control} name="due_time" render={({ field }) => <TimeField id="edit-due-time" value={field.value} onChange={field.onChange} disabled={disabledSchedule} invalid={!!errors.due_time} />} />
            <FieldError errors={[errors.due_time]} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.priority}>
            <FieldLabel htmlFor="edit-priority">Priority</FieldLabel>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Select value={String(field.value ?? "3")} onValueChange={field.onChange} disabled={disabledSchedule}>
                  <SelectTrigger id="edit-priority" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={String(p)}>{PRIORITY_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.priority]} />
          </Field>
          <Field data-invalid={!!errors.estimate_minutes}>
            <FieldLabel htmlFor="edit-estimate">Estimate (minutes)</FieldLabel>
            <Input id="edit-estimate" inputMode="numeric" autoComplete="off" disabled={disabledSchedule} aria-invalid={!!errors.estimate_minutes} {...form.register("estimate_minutes")} />
            <FieldError errors={[errors.estimate_minutes]} />
          </Field>
        </div>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      {canEditDetails && canEditGroup && groupSize > 1 && (
        <div className="flex items-start gap-2 text-sm">
          <Checkbox id="edit-everyone" checked={everyone} onCheckedChange={(on) => setEveryone(on === true)} />
          <label htmlFor="edit-everyone">
            Also apply the title, details, priority, department and category to the other open tasks in this group.
            <span className="text-muted-foreground block text-xs">Deadlines, estimates and status stay each person&apos;s own.</span>
          </label>
        </div>
      )}
      {canSchedule && (
        <Button type="submit" disabled={isSubmitting || !isDirty}>{isSubmitting && <Spinner />} Save changes</Button>
      )}
    </form>
  );
}

type Option = { id: string; full_name: string };

/** Hand the task to someone, or back to the queue. Only the people the guard allows (managers) see this. */
export function AssignControl({ taskId, current, owners }: { taskId: string; current: string | null; owners: Option[] }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor="assign-to" className="text-muted-foreground text-xs">Assign to</label>
      <Select
        value={current ?? UNASSIGNED}
        disabled={pending}
        onValueChange={async (v) => {
          setPending(true);
          const res = await assignTask({ id: taskId, assignee_id: v === UNASSIGNED ? null : v });
          setPending(false);
          if (!res.ok) toast.error(res.error);
          else toast.success(v === UNASSIGNED ? "Moved to the team queue" : "Task assigned");
        }}
      >
        <SelectTrigger id="assign-to" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned (team queue)</SelectItem>
          {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Cancel every open task in the group with one reason. Creator or founder only; the database checks. */
export function CancelGroup({ taskId, open }: { taskId: string; open: number }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  if (!asking) return <Button type="button" variant="outline" size="sm" onClick={() => setAsking(true)}>Cancel the open tasks for everyone</Button>;
  return (
    <div className="space-y-2">
      <label htmlFor="cancel-group-reason" className="text-muted-foreground text-xs">Why are the {open} open tasks cancelled?</label>
      <Input id="cancel-group-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending || reason.trim() === ""}
          onClick={async () => {
            setPending(true);
            const res = await cancelTaskGroup({ id: taskId, reason });
            setPending(false);
            if (!res.ok) toast.error(res.error);
            else {
              toast.success(`${res.data.cancelled} ${res.data.cancelled === 1 ? "task" : "tasks"} cancelled`);
              setAsking(false);
            }
          }}
        >
          {pending && <Spinner />} Cancel them
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>Keep them</Button>
      </div>
    </div>
  );
}
