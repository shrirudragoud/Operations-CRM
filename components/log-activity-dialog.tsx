"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { DateField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InstitutionPicker } from "@/components/institution-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { logActivity } from "@/lib/actions/activity";
import { todayIST } from "@/lib/format";
import {
  ACTIVITY_KINDS, KIND_LABELS, OUTCOMES, OUTCOME_LABELS, activitySchema, type ActivityInput, type ActivityValues,
} from "@/lib/schemas/activity";

const NO_VALUE = "none"; // Radix Select cannot use an empty string as a value.

export type ActivityContact = { id: string; full_name: string };
type FixedInstitution = { id: string; name: string };

/**
 * Log a visit, call, email, WhatsApp, STEM class or booth. With `institution` the target is fixed
 * (Institution 360); without it the user searches for one (Outreach). The database does the rest:
 * stage change, Workshop deal on "qualified" and the follow-up task.
 */
export function LogActivityButton({
  institution, contacts = [], label = "Log activity", variant = "default",
}: { institution?: FixedInstitution; contacts?: ActivityContact[]; label?: string; variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><PlusIcon aria-hidden /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <ActivityForm institution={institution} contacts={contacts} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActivityForm({
  institution, contacts, onDone,
}: { institution?: FixedInstitution; contacts: ActivityContact[]; onDone: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const today = todayIST();
  const form = useForm<ActivityInput, unknown, ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      institution_id: institution?.id ?? "",
      contact_id: "",
      kind: "visit",
      outcome: "",
      notes: "",
      happened_on: today,
      next_step: "",
      next_step_due: "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const outcome = useWatch({ control: form.control, name: "outcome" });

  async function onSubmit() {
    setServerError(null);
    const res = await logActivity(form.getValues());
    if (!res.ok) {
      for (const [key, msgs] of Object.entries(res.fieldErrors ?? {})) {
        form.setError(key as keyof ActivityInput, { message: msgs[0] });
      }
      setServerError(res.error);
      return;
    }
    const extras = [res.data.dealCreated && "Workshop deal is open at Meeting", res.data.followUpCreated && "follow-up task created"].filter(Boolean);
    toast.success("Activity logged", { description: extras.length ? extras.join("; ") : undefined });
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>Log activity</DialogTitle>
        <DialogDescription>
          {institution ? `What happened with ${institution.name}.` : "Record a touch so the next person knows where things stand."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {!institution && (
          <Field data-invalid={!!errors.institution_id}>
            <FieldLabel htmlFor="activity-institution">Institution</FieldLabel>
            <Controller
              control={form.control}
              name="institution_id"
              render={({ field }) => <InstitutionPicker id="activity-institution" value={field.value} onChange={field.onChange} invalid={!!errors.institution_id} />}
            />
            <FieldError errors={[errors.institution_id]} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.kind}>
            <FieldLabel htmlFor="activity-kind">What did you do?</FieldLabel>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="activity-kind" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.kind]} />
          </Field>
          <Field data-invalid={!!errors.outcome}>
            <FieldLabel htmlFor="activity-outcome">Outcome</FieldLabel>
            <Controller
              control={form.control}
              name="outcome"
              render={({ field }) => (
                <Select value={field.value || NO_VALUE} onValueChange={(v) => field.onChange(v === NO_VALUE ? "" : v)}>
                  <SelectTrigger id="activity-outcome" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VALUE}>Not set</SelectItem>
                    {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABELS[o]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.outcome]} />
          </Field>
        </div>
        {outcome === "qualified" && (
          <Alert>
            <AlertDescription>
              Qualified moves the institution to Qualified and opens a Workshop deal at Meeting, unless it already has one open.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {institution && contacts.length > 0 && (
            <Field data-invalid={!!errors.contact_id}>
              <FieldLabel htmlFor="activity-contact">Spoke to</FieldLabel>
              <Controller
                control={form.control}
                name="contact_id"
                render={({ field }) => (
                  <Select value={field.value || NO_VALUE} onValueChange={(v) => field.onChange(v === NO_VALUE ? "" : v)}>
                    <SelectTrigger id="activity-contact" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VALUE}>Not recorded</SelectItem>
                      {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[errors.contact_id]} />
            </Field>
          )}
          <Field data-invalid={!!errors.happened_on}>
            <FieldLabel htmlFor="activity-date">Date</FieldLabel>
            <Controller control={form.control} name="happened_on" render={({ field }) => <DateField id="activity-date" value={field.value} onChange={field.onChange} max={today} invalid={!!errors.happened_on} />} />
            <FieldError errors={[errors.happened_on]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="activity-notes">Notes</FieldLabel>
          <Textarea id="activity-notes" rows={3} aria-invalid={!!errors.notes} {...form.register("notes")} />
          <FieldError errors={[errors.notes]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field data-invalid={!!errors.next_step}>
            <FieldLabel htmlFor="activity-next">Next step</FieldLabel>
            <Input id="activity-next" autoComplete="off" aria-invalid={!!errors.next_step} {...form.register("next_step")} />
            <FieldError errors={[errors.next_step]} />
          </Field>
          <Field data-invalid={!!errors.next_step_due}>
            <FieldLabel htmlFor="activity-due">Due</FieldLabel>
            <Controller control={form.control} name="next_step_due" render={({ field }) => <DateField id="activity-due" value={field.value} onChange={field.onChange} min={today} invalid={!!errors.next_step_due} />} />
            <FieldError errors={[errors.next_step_due]} />
          </Field>
        </div>
        <FieldDescription>A next step with a due date becomes a follow-up task for you.</FieldDescription>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Log activity</Button>
      </DialogFooter>
    </form>
  );
}
