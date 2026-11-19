"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { DateField, TimeField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { clearDayMark, correctCheckout, decideRequest, excuseDay } from "@/lib/actions/attendance";
import { correctSchema, excuseSchema, type CorrectInput, type ExcuseInput } from "@/lib/schemas/attendance";

/** Approve or decline a request for time. Declining takes an optional note the person can read. */
export function DecideButtons({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  function decide(approve: boolean) {
    startTransition(async () => {
      const res = await decideRequest({ id, approve, note: note.trim() || undefined });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(approve ? `Approved for ${name}` : `Declined for ${name}`);
      setOpen(false);
    });
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => decide(true)}>Approve</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="outline" disabled={pending}>Decline</Button></DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline {name}&apos;s request?</DialogTitle>
            <DialogDescription>They will see your note.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Note" rows={2} placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => decide(false)}>{pending && <Spinner />} Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Someone checked in and never out: a lead says when they left. Hours are never guessed. */
export function FixCheckoutDialog({ sessionId, workDate, name }: { sessionId: string; workDate: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Set check-out</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">{open && <FixForm sessionId={sessionId} workDate={workDate} name={name} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function FixForm({ sessionId, workDate, name, onDone }: { sessionId: string; workDate: string; name: string; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<CorrectInput>({
    resolver: zodResolver(correctSchema),
    defaultValues: { session_id: sessionId, work_date: workDate, out_time: "17:00", note: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: CorrectInput) {
    setServerError(null);
    const res = await correctCheckout(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof CorrectInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success(`Check-out set for ${name}`);
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>When did {name} leave?</DialogTitle>
        <DialogDescription>They did not check out on that day. Your note is kept with the record.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.out_time}>
          <FieldLabel htmlFor="fix-out">Left at</FieldLabel>
          <Controller control={form.control} name="out_time" render={({ field }) => <TimeField id="fix-out" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.out_time} />} />
          <FieldError errors={[errors.out_time]} />
        </Field>
        <Field data-invalid={!!errors.note}>
          <FieldLabel htmlFor="fix-note">How do you know?</FieldLabel>
          <Textarea id="fix-note" rows={2} aria-invalid={!!errors.note} {...form.register("note")} />
          <FieldError errors={[errors.note]} />
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

/** A lead excuses someone for a day (leave, a visit, a holiday for one person). It is not counted as absent. */
export function ExcuseDialog({ people, today }: { people: { id: string; name: string }[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Excuse a day</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">{open && <ExcuseForm people={people} today={today} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function ExcuseForm({ people, today, onDone }: { people: { id: string; name: string }[]; today: string; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ExcuseInput>({ resolver: zodResolver(excuseSchema), defaultValues: { staff_id: "", date: today, reason: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: ExcuseInput) {
    setServerError(null);
    const res = await excuseDay(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof ExcuseInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Day excused");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>Excuse a day</DialogTitle>
        <DialogDescription>For leave or a day away that you have agreed to. It will not count as absent.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.staff_id}>
          <FieldLabel htmlFor="excuse-person">Who</FieldLabel>
          <Controller
            control={form.control}
            name="staff_id"
            render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="excuse-person" className="w-full" aria-invalid={!!errors.staff_id}><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.staff_id && { message: "Choose a person." }]} />
        </Field>
        <Field data-invalid={!!errors.date}>
          <FieldLabel htmlFor="excuse-date">Day</FieldLabel>
          <Controller control={form.control} name="date" render={({ field }) => <DateField id="excuse-date" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.date} />} />
          <FieldError errors={[errors.date]} />
        </Field>
        <Field data-invalid={!!errors.reason}>
          <FieldLabel htmlFor="excuse-reason">Why</FieldLabel>
          <Textarea id="excuse-reason" rows={2} aria-invalid={!!errors.reason} {...form.register("reason")} />
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

/** Take back a remote or excused mark. */
export function ClearMarkButton({ staffId, date }: { staffId: string; date: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await clearDayMark({ staff_id: staffId, date });
          if (!res.ok) toast.error(res.error);
          else toast.success("Mark removed");
        })
      }
    >
      Remove
    </Button>
  );
}
