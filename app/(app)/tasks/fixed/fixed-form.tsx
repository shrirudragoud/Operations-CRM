"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { DateField, TimeField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveRecurrence } from "@/lib/actions/task-collab";
import { DEPARTMENT_LABELS, type Department } from "@/lib/permissions";
import {
  FREQUENCY_LABELS, PRIORITIES, PRIORITY_LABELS, RECURRENCE_FREQUENCIES, recurrenceSchema, WEEKDAY_LABELS,
  type RecurrenceFrequency, type RecurrenceInput, type RecurrenceValues,
} from "@/lib/schemas/task";

export type StaffOption = { id: string; full_name: string };

export type RecurrenceFormValues = {
  id?: string;
  title: string;
  description: string;
  department: Department;
  priority: string;
  estimate_minutes: string;
  frequency: RecurrenceFrequency;
  weekday: string;
  month_day: string;
  due_after_days: string;
  due_time: string;
  starts_on: string;
  ends_on: string;
  all_department: boolean;
  staff_ids: string[];
  active: boolean;
};

type Props = {
  departments: Department[];
  staff: StaffOption[];
  initial?: RecurrenceFormValues;
  today: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
};

export function FixedTaskButton({ departments, staff, initial, today, label = "New fixed task", variant = "default" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={initial ? "sm" : "default"} onClick={() => setOpen(true)}>
        {!initial && <PlusIcon aria-hidden />} {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {open && <FixedForm departments={departments} staff={staff} initial={initial} today={today} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FixedForm({ departments, staff, initial, today, onDone }: Omit<Props, "label" | "variant"> & { onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RecurrenceInput, unknown, RecurrenceValues>({
    resolver: zodResolver(recurrenceSchema),
    defaultValues: initial ?? {
      title: "", description: "", department: departments[0] ?? "sales", priority: "3", estimate_minutes: "", frequency: "weekdays",
      weekday: "1", month_day: "1", due_after_days: "0", due_time: "", starts_on: today, ends_on: "", all_department: true, staff_ids: [], active: true,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const frequency = useWatch({ control: form.control, name: "frequency" });
  const allDepartment = useWatch({ control: form.control, name: "all_department" });
  const chosen = useWatch({ control: form.control, name: "staff_ids" }) ?? [];

  async function onSubmit() {
    setServerError(null);
    const res = await saveRecurrence(form.getValues());
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof RecurrenceInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success(initial ? "Fixed task saved" : "Fixed task created. Tasks appear when the schedule reaches them.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit fixed task" : "New fixed task"}</DialogTitle>
        <DialogDescription>
          A task the system creates on a schedule, one copy per person, each with its own start and deadline.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="fx-title">Title</FieldLabel>
          <Input id="fx-title" autoComplete="off" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="fx-description">Details (optional)</FieldLabel>
          <Textarea id="fx-description" rows={3} aria-invalid={!!errors.description} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.department}>
            <FieldLabel htmlFor="fx-department">Department</FieldLabel>
            <Controller
              control={form.control}
              name="department"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="fx-department" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.department]} />
          </Field>
          <Field data-invalid={!!errors.frequency}>
            <FieldLabel htmlFor="fx-frequency">Repeats</FieldLabel>
            <Controller
              control={form.control}
              name="frequency"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="fx-frequency" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.frequency]} />
          </Field>
        </div>
        {frequency === "weekly" && (
          <Field data-invalid={!!errors.weekday}>
            <FieldLabel htmlFor="fx-weekday">On</FieldLabel>
            <Controller
              control={form.control}
              name="weekday"
              render={({ field }) => (
                <Select value={String(field.value ?? "1")} onValueChange={field.onChange}>
                  <SelectTrigger id="fx-weekday" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_LABELS.map((d, i) => <SelectItem key={d} value={String(i + 1)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.weekday]} />
          </Field>
        )}
        {frequency === "monthly" && (
          <Field data-invalid={!!errors.month_day}>
            <FieldLabel htmlFor="fx-month-day">Day of the month (1 to 28)</FieldLabel>
            <Input id="fx-month-day" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.month_day} {...form.register("month_day")} />
            <FieldError errors={[errors.month_day]} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.starts_on}>
            <FieldLabel htmlFor="fx-starts">Starts on</FieldLabel>
            <Controller control={form.control} name="starts_on" render={({ field }) => <DateField id="fx-starts" value={field.value} onChange={field.onChange} invalid={!!errors.starts_on} />} />
            <FieldError errors={[errors.starts_on]} />
          </Field>
          <Field data-invalid={!!errors.ends_on}>
            <FieldLabel htmlFor="fx-ends">Ends on (optional)</FieldLabel>
            <Controller control={form.control} name="ends_on" render={({ field }) => <DateField id="fx-ends" value={field.value} onChange={field.onChange} invalid={!!errors.ends_on} />} />
            <FieldError errors={[errors.ends_on]} />
          </Field>
          <Field data-invalid={!!errors.due_after_days}>
            <FieldLabel htmlFor="fx-due-after">Deadline after (days)</FieldLabel>
            <Input id="fx-due-after" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.due_after_days} {...form.register("due_after_days")} />
            <FieldDescription>0 = same day.</FieldDescription>
            <FieldError errors={[errors.due_after_days]} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.due_time}>
            <FieldLabel htmlFor="fx-due-time">Deadline time (India)</FieldLabel>
            <Controller control={form.control} name="due_time" render={({ field }) => <TimeField id="fx-due-time" value={field.value} onChange={field.onChange} invalid={!!errors.due_time} />} />
            <FieldError errors={[errors.due_time]} />
          </Field>
          <Field data-invalid={!!errors.priority}>
            <FieldLabel htmlFor="fx-priority">Priority</FieldLabel>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Select value={String(field.value ?? "3")} onValueChange={field.onChange}>
                  <SelectTrigger id="fx-priority" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={String(p)}>{PRIORITY_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field data-invalid={!!errors.estimate_minutes}>
            <FieldLabel htmlFor="fx-estimate">Estimate (minutes)</FieldLabel>
            <Input id="fx-estimate" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.estimate_minutes} {...form.register("estimate_minutes")} />
            <FieldError errors={[errors.estimate_minutes]} />
          </Field>
        </div>

        <Field data-invalid={!!errors.staff_ids}>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="fx-all">Everyone in the department</FieldLabel>
            <Controller
              control={form.control}
              name="all_department"
              render={({ field }) => <Switch id="fx-all" checked={field.value} onCheckedChange={field.onChange} />}
            />
          </div>
          <FieldDescription>
            {allDepartment ? "Every active member of the department gets their own copy." : "Only the people you pick below get a copy."}
          </FieldDescription>
          {!allDepartment && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="People">
              {staff.map((s) => {
                const id = `fx-staff-${s.id}`;
                return (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={id}
                      checked={chosen.includes(s.id)}
                      onCheckedChange={(on) => form.setValue("staff_ids", on ? [...chosen, s.id] : chosen.filter((x) => x !== s.id), { shouldDirty: true, shouldValidate: true })}
                    />
                    <label htmlFor={id}>{s.full_name}</label>
                  </li>
                );
              })}
            </ul>
          )}
          <FieldError errors={[errors.staff_ids as { message?: string } | undefined]} />
        </Field>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} {initial ? "Save changes" : "Create fixed task"}</Button>
      </DialogFooter>
    </form>
  );
}
