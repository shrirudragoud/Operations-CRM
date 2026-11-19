"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { saveLeaveType } from "@/lib/actions/leave";
import type { LeaveType } from "@/lib/leave";

type FormValues = {
  name: string; paid: boolean; has_balance: boolean; annual_quota: string; carry_forward: boolean; carry_cap: string;
  count_weekends: boolean; count_holidays: boolean; half_day_allowed: boolean; needs_document: boolean; is_active: boolean;
};

const BLANK: FormValues = {
  name: "", paid: true, has_balance: true, annual_quota: "12", carry_forward: false, carry_cap: "",
  count_weekends: false, count_holidays: false, half_day_allowed: true, needs_document: false, is_active: true,
};

const fromType = (t: LeaveType): FormValues => ({
  name: t.name, paid: t.paid, has_balance: t.has_balance, annual_quota: String(t.annual_quota), carry_forward: t.carry_forward,
  carry_cap: t.carry_cap === null ? "" : String(t.carry_cap), count_weekends: t.count_weekends, count_holidays: t.count_holidays,
  half_day_allowed: t.half_day_allowed, needs_document: t.needs_document, is_active: t.is_active,
});

/** Create a leave type, or change one. The rules are stored on the type, so a change here is the whole policy. */
export function LeaveTypeDialog({ type }: { type?: LeaveType }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {type ? (
          <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${type.name}`}><PencilIcon aria-hidden /> Edit</Button>
        ) : (
          <Button type="button"><PlusIcon aria-hidden /> Add a type of leave</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && <TypeForm type={type} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SwitchRow({ id, label, hint, control }: { id: string; label: string; hint: string; control: React.ReactNode }) {
  return (
    <Field orientation="horizontal">
      {control}
      <div className="space-y-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{hint}</FieldDescription>
      </div>
    </Field>
  );
}

function TypeForm({ type, onDone }: { type?: LeaveType; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: type ? fromType(type) : BLANK });
  const { errors, isSubmitting } = form.formState;
  const [hasBalance, carry] = form.watch(["has_balance", "carry_forward"]);

  async function onSubmit(v: FormValues) {
    setServerError(null);
    const res = await saveLeaveType({ ...v, id: type?.id, code: type?.code });
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof FormValues, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success(type ? "Leave type saved" : "Leave type added");
    onDone();
  }

  const sw = (name: keyof Pick<FormValues, "paid" | "has_balance" | "carry_forward" | "count_weekends" | "count_holidays" | "half_day_allowed" | "needs_document" | "is_active">, id: string) => (
    <Controller control={form.control} name={name} render={({ field }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />} />
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>{type ? `Edit ${type.name}` : "Add a type of leave"}</DialogTitle>
        <DialogDescription>These rules apply to everyone from the next application. Leave already approved is not changed.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="lt-name">Name</FieldLabel>
          <Input id="lt-name" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <SwitchRow id="lt-balance" label="Keep a balance" hint="Off for leave with no limit, such as unpaid leave. Nothing is counted against anyone." control={sw("has_balance", "lt-balance")} />
        {hasBalance && (
          <>
            <Field data-invalid={!!errors.annual_quota}>
              <FieldLabel htmlFor="lt-quota">Days a year</FieldLabel>
              <Input id="lt-quota" inputMode="decimal" aria-invalid={!!errors.annual_quota} {...form.register("annual_quota")} />
              <FieldDescription>Credited to each person at the start of the year. Use 0 for leave that HR grants one day at a time, like comp-off.</FieldDescription>
              <FieldError errors={[errors.annual_quota]} />
            </Field>
            <SwitchRow id="lt-carry" label="Carry forward" hint="Unused days move into next year." control={sw("carry_forward", "lt-carry")} />
            {carry && (
              <Field data-invalid={!!errors.carry_cap}>
                <FieldLabel htmlFor="lt-cap">Most days that carry over</FieldLabel>
                <Input id="lt-cap" inputMode="decimal" placeholder="No limit" aria-invalid={!!errors.carry_cap} {...form.register("carry_cap")} />
                <FieldDescription>Leave empty for no limit.</FieldDescription>
                <FieldError errors={[errors.carry_cap]} />
              </Field>
            )}
          </>
        )}
        <SwitchRow id="lt-weekends" label="Weekends inside a leave count" hint="Off: a leave over a weekend does not use up the Saturday and Sunday." control={sw("count_weekends", "lt-weekends")} />
        <SwitchRow id="lt-holidays" label="Holidays inside a leave count" hint="Off: an office holiday inside a leave is not counted." control={sw("count_holidays", "lt-holidays")} />
        <SwitchRow id="lt-half" label="Half days allowed" hint="People can take the first or second half of a single day." control={sw("half_day_allowed", "lt-half")} />
        <SwitchRow id="lt-paid" label="Paid" hint="Shown to HR for payroll. It does not change how days are counted." control={sw("paid", "lt-paid")} />
        <SwitchRow id="lt-doc" label="Needs a document" hint="Reminds the person to keep one ready, such as a medical certificate." control={sw("needs_document", "lt-doc")} />
        <SwitchRow id="lt-active" label="In use" hint="Off hides it from new applications. Existing leave and balances stay." control={sw("is_active", "lt-active")} />
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save</Button>
      </DialogFooter>
    </form>
  );
}
