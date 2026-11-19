"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { CalendarPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { DateField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { applyForLeave } from "@/lib/actions/leave";
import { daysText, previewDays, type DayPart, type LeaveBalance, type LeaveType } from "@/lib/leave";
import { DAY_PART_LABELS } from "@/lib/schemas/leave";

export type PersonOption = { id: string; full_name: string };

type FormValues = { staff_id: string; leave_type_id: string; from_date: string; to_date: string; day_part: DayPart; reason: string };

/**
 * Apply for leave. With `people`, HR records it for someone else and it is approved at once. The database re-checks everything
 * (balance, overlaps, back-dating); its message is shown as it is. The day count here is only a preview.
 */
export function ApplyLeaveDialog({
  types, balances, workDays, holidays, today, people, label = "Apply for leave",
}: {
  types: LeaveType[];
  balances: LeaveBalance[];
  workDays: number[];
  holidays: string[];
  today: string;
  people?: PersonOption[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={people ? "outline" : "default"}><CalendarPlusIcon aria-hidden /> {label}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {open && <ApplyForm types={types} balances={balances} workDays={workDays} holidays={holidays} today={today} people={people} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ApplyForm({
  types, balances, workDays, holidays, today, people, onDone,
}: { types: LeaveType[]; balances: LeaveBalance[]; workDays: number[]; holidays: string[]; today: string; people?: PersonOption[]; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: { staff_id: "", leave_type_id: "", from_date: today, to_date: today, day_part: "full", reason: "" } });
  const { errors, isSubmitting } = form.formState;
  const [typeId, from, to, part] = form.watch(["leave_type_id", "from_date", "to_date", "day_part"]);
  const type = types.find((t) => t.id === typeId);
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const days = type ? previewDays(type, from, to, part, workDays, holidaySet) : 0;
  const balance = balances.find((b) => b.leave_type_id === typeId);
  const behalf = !!people;

  async function onSubmit(v: FormValues) {
    setServerError(null);
    if (behalf && !v.staff_id) {
      form.setError("staff_id", { message: "Choose a person." });
      return;
    }
    const res = await applyForLeave({ ...v, staff_id: behalf ? v.staff_id : undefined });
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof FormValues, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success(behalf ? "Leave recorded and approved" : "Leave requested");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>{behalf ? "Record leave for someone" : "Apply for leave"}</DialogTitle>
        <DialogDescription>
          {behalf ? "Leave recorded by HR is approved at once and counted against their balance." : "Your lead or HR will approve it. Until then it is held against your balance."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {behalf && (
          <Field data-invalid={!!errors.staff_id}>
            <FieldLabel htmlFor="leave-person">Person</FieldLabel>
            <Controller
              control={form.control}
              name="staff_id"
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="leave-person" className="w-full" aria-invalid={!!errors.staff_id}><SelectValue placeholder="Choose a person" /></SelectTrigger>
                  <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.staff_id]} />
          </Field>
        )}
        <Field data-invalid={!!errors.leave_type_id}>
          <FieldLabel htmlFor="leave-type">Type of leave</FieldLabel>
          <Controller
            control={form.control}
            name="leave_type_id"
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={(v) => {
                  field.onChange(v);
                  if (!types.find((t) => t.id === v)?.half_day_allowed) form.setValue("day_part", "full");
                }}
              >
                <SelectTrigger id="leave-type" className="w-full" aria-invalid={!!errors.leave_type_id}><SelectValue placeholder="Choose a type" /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          />
          {!behalf && type?.has_balance && balance && (
            <FieldDescription>{daysText(balance.available ?? balance.balance)} free to take.</FieldDescription>
          )}
          {type && !type.has_balance && <FieldDescription>No balance is kept for this type.</FieldDescription>}
          <FieldError errors={[errors.leave_type_id]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.from_date}>
            <FieldLabel htmlFor="leave-from">First day</FieldLabel>
            <Controller
              control={form.control}
              name="from_date"
              render={({ field }) => (
                <DateField
                  id="leave-from"
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    if (!form.getValues("to_date") || form.getValues("to_date") < v) form.setValue("to_date", v);
                  }}
                  clearable={false}
                  invalid={!!errors.from_date}
                />
              )}
            />
            <FieldError errors={[errors.from_date]} />
          </Field>
          <Field data-invalid={!!errors.to_date}>
            <FieldLabel htmlFor="leave-to">Last day</FieldLabel>
            <Controller
              control={form.control}
              name="to_date"
              render={({ field }) => <DateField id="leave-to" value={field.value} onChange={field.onChange} min={from || undefined} clearable={false} invalid={!!errors.to_date} />}
            />
            <FieldError errors={[errors.to_date]} />
          </Field>
        </div>
        {type?.half_day_allowed && from && from === to && (
          <Field data-invalid={!!errors.day_part}>
            <FieldLabel htmlFor="leave-part">How much of the day</FieldLabel>
            <Controller
              control={form.control}
              name="day_part"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="leave-part" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DAY_PART_LABELS) as DayPart[]).map((p) => <SelectItem key={p} value={p}>{DAY_PART_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.day_part]} />
          </Field>
        )}
        <Field data-invalid={!!errors.reason}>
          <FieldLabel htmlFor="leave-reason">Reason</FieldLabel>
          <Textarea id="leave-reason" rows={2} aria-invalid={!!errors.reason} {...form.register("reason")} />
          <FieldError errors={[errors.reason]} />
        </Field>
        {type && (
          <p role="status" className="text-sm">
            {days > 0 ? <>This is <strong>{daysText(days)}</strong> of leave.</> : <span className="text-muted-foreground">No working days fall in these dates.</span>}
            {type.needs_document && <span className="text-muted-foreground"> Keep a document ready for HR.</span>}
          </p>
        )}
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} {behalf ? "Record leave" : "Send request"}</Button>
      </DialogFooter>
    </form>
  );
}
