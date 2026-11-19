"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { DateField, TimeField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { declareRemote, requestAttendance } from "@/lib/actions/attendance";
import { remoteSchema, requestSchema, type RemoteInput, type RequestInput } from "@/lib/schemas/attendance";

/** Ask for a day's time by hand: for when the office network could not be reached. A lead approves it. */
export function AskForTimeDialog({ today, earliest, defaultOpen = false, start, end }: { today: string; earliest: string; defaultOpen?: boolean; start: string; end: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Ask for time</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open && <AskForm today={today} earliest={earliest} start={start} end={end} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AskForm({ today, earliest, start, end, onDone }: { today: string; earliest: string; start: string; end: string; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RequestInput>({
    resolver: zodResolver(requestSchema),
    defaultValues: { work_date: today, in_time: start, out_time: end, reason: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: RequestInput) {
    setServerError(null);
    const res = await requestAttendance(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof RequestInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Sent. A lead will look at it.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>Ask for time at the office</DialogTitle>
        <DialogDescription>For a day you were in but could not check in, such as a phone on mobile data. A lead approves it.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.work_date}>
          <FieldLabel htmlFor="ask-date">Day</FieldLabel>
          <Controller control={form.control} name="work_date" render={({ field }) => <DateField id="ask-date" value={field.value} onChange={field.onChange} min={earliest} max={today} clearable={false} invalid={!!errors.work_date} />} />
          <FieldDescription>Today or any of the last 7 days.</FieldDescription>
          <FieldError errors={[errors.work_date]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.in_time}>
            <FieldLabel htmlFor="ask-in">Arrived</FieldLabel>
            <Controller control={form.control} name="in_time" render={({ field }) => <TimeField id="ask-in" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.in_time} />} />
            <FieldError errors={[errors.in_time]} />
          </Field>
          <Field data-invalid={!!errors.out_time}>
            <FieldLabel htmlFor="ask-out">Left</FieldLabel>
            <Controller control={form.control} name="out_time" render={({ field }) => <TimeField id="ask-out" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.out_time} />} />
            <FieldError errors={[errors.out_time]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.reason}>
          <FieldLabel htmlFor="ask-reason">Why</FieldLabel>
          <Textarea id="ask-reason" rows={2} aria-invalid={!!errors.reason} {...form.register("reason")} />
          <FieldError errors={[errors.reason]} />
        </Field>
      </FieldGroup>
      {serverError && <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Send</Button>
      </DialogFooter>
    </form>
  );
}

/** Say you are working away from the office on a day, so it is not counted as absent. */
export function RemoteDialog({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Working remotely</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open && <RemoteForm today={today} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RemoteForm({ today, onDone }: { today: string; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RemoteInput>({ resolver: zodResolver(remoteSchema), defaultValues: { date: today, reason: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: RemoteInput) {
    setServerError(null);
    const res = await declareRemote(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof RemoteInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Noted. That day is marked as working remotely.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>Working remotely</DialogTitle>
        <DialogDescription>Not coming to the office that day. It will not count as absent, and your lead can see why.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.date}>
          <FieldLabel htmlFor="remote-date">Day</FieldLabel>
          <Controller control={form.control} name="date" render={({ field }) => <DateField id="remote-date" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.date} />} />
          <FieldError errors={[errors.date]} />
        </Field>
        <Field data-invalid={!!errors.reason}>
          <FieldLabel htmlFor="remote-reason">Why</FieldLabel>
          <Textarea id="remote-reason" rows={2} aria-invalid={!!errors.reason} {...form.register("reason")} />
          <FieldError errors={[errors.reason]} />
        </Field>
      </FieldGroup>
      {serverError && <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save</Button>
      </DialogFooter>
    </form>
  );
}
