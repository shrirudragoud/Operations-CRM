"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { PlusIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { DateField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addLeaveHoliday, adjustBalance, removeLeaveHoliday, startLeaveYear } from "@/lib/actions/leave";
import { rangeText, type LeaveType } from "@/lib/leave";
import type { PersonOption } from "./apply-dialog";

export type HolidayRow = { id: string; holiday_date: string; name: string };

/** Office holidays. They are skipped inside a leave unless the type counts holidays. */
export function HolidayManager({ holidays, today }: { holidays: HolidayRow[]; today: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ holiday_date: string; name: string }>({ defaultValues: { holiday_date: "", name: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: { holiday_date: string; name: string }) {
    setError(null);
    const res = await addLeaveHoliday(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as "name" | "holiday_date", { message: msgs[0] });
      if (fields.length === 0) setError(res.error);
      return;
    }
    toast.success("Holiday added");
    form.reset({ holiday_date: "", name: "" });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-wrap items-start gap-3" aria-label="Add a holiday">
        <Field className="w-44" data-invalid={!!errors.holiday_date}>
          <FieldLabel htmlFor="hol-date">Day</FieldLabel>
          <Controller control={form.control} name="holiday_date" render={({ field }) => <DateField id="hol-date" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.holiday_date} />} />
          <FieldError errors={[errors.holiday_date]} />
        </Field>
        <Field className="w-56" data-invalid={!!errors.name}>
          <FieldLabel htmlFor="hol-name">Name</FieldLabel>
          <Input id="hol-name" autoComplete="off" placeholder="Diwali" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Button type="submit" className="mt-6" disabled={isSubmitting}>{isSubmitting ? <Spinner /> : <PlusIcon aria-hidden />} Add holiday</Button>
      </form>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {holidays.length === 0 ? (
        <p className="text-muted-foreground text-sm">No upcoming holidays are set.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm" aria-label="Upcoming holidays">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-medium">{h.name}</span>
                <span className="text-muted-foreground"> · {rangeText(h.holiday_date, h.holiday_date, "full", today.slice(0, 4))}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Remove ${h.name}`}
                onClick={() =>
                  start(async () => {
                    const res = await removeLeaveHoliday({ id: h.id });
                    if (res.ok) toast.success("Holiday removed");
                    else toast.error(res.error);
                  })
                }
              >
                <Trash2Icon aria-hidden /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type AdjustValues = { staff_id: string; leave_type_id: string; year: string; days: string; note: string };

/** Add or take away days for one person, with a reason that stays in the ledger. */
export function AdjustBalanceDialog({ people, types, year, staffId }: { people: PersonOption[]; types: LeaveType[]; year: number; staffId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={staffId ? "ghost" : "outline"} size={staffId ? "sm" : "default"} aria-label={staffId ? "Adjust this balance" : undefined}>
          <SlidersHorizontalIcon aria-hidden /> {staffId ? "Adjust" : "Adjust a balance"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open && <AdjustForm people={people} types={types} year={year} staffId={staffId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AdjustForm({ people, types, year, staffId, onDone }: { people: PersonOption[]; types: LeaveType[]; year: number; staffId?: string; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AdjustValues>({ defaultValues: { staff_id: staffId ?? "", leave_type_id: "", year: String(year), days: "", note: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: AdjustValues) {
    setServerError(null);
    const res = await adjustBalance(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof AdjustValues, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Balance adjusted");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>Adjust a balance</DialogTitle>
        <DialogDescription>Add days with a plus number, or take them away with a minus. The reason is kept with the change.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.staff_id}>
          <FieldLabel htmlFor="adj-person">Person</FieldLabel>
          <Controller
            control={form.control}
            name="staff_id"
            render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange} disabled={!!staffId}>
                <SelectTrigger id="adj-person" className="w-full" aria-invalid={!!errors.staff_id}><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.staff_id]} />
        </Field>
        <Field data-invalid={!!errors.leave_type_id}>
          <FieldLabel htmlFor="adj-type">Type of leave</FieldLabel>
          <Controller
            control={form.control}
            name="leave_type_id"
            render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="adj-type" className="w-full" aria-invalid={!!errors.leave_type_id}><SelectValue placeholder="Choose a type" /></SelectTrigger>
                <SelectContent>{types.filter((t) => t.has_balance).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.leave_type_id]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.year}>
            <FieldLabel htmlFor="adj-year">Year</FieldLabel>
            <Input id="adj-year" inputMode="numeric" aria-invalid={!!errors.year} {...form.register("year")} />
            <FieldError errors={[errors.year]} />
          </Field>
          <Field data-invalid={!!errors.days}>
            <FieldLabel htmlFor="adj-days">Days (+ or -)</FieldLabel>
            <Input id="adj-days" inputMode="decimal" placeholder="2 or -1" aria-invalid={!!errors.days} {...form.register("days")} />
            <FieldError errors={[errors.days]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.note}>
          <FieldLabel htmlFor="adj-note">Reason</FieldLabel>
          <Textarea id="adj-note" rows={2} aria-invalid={!!errors.note} {...form.register("note")} />
          <FieldDescription>For example, a day granted for working on a holiday.</FieldDescription>
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
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save</Button>
      </DialogFooter>
    </form>
  );
}

/** Credits the yearly quota to everyone (and carries unused days over). Safe to press twice: nobody is credited twice. */
export function StartYearButton({ year }: { year: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await startLeaveYear({ year });
          if (res.ok) toast.success(`Leave for ${year} is set up for ${res.data.people} ${res.data.people === 1 ? "person" : "people"}`);
          else toast.error(res.error);
        })
      }
    >
      {pending && <Spinner />} Set up {year}
    </Button>
  );
}
