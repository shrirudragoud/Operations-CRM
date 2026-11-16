"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { InstitutionPicker } from "@/components/institution-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { createDeal } from "@/lib/actions/deal";
import {
  DEAL_KINDS, DEAL_KIND_LABELS, STAGE_PROBABILITY, dealSchema, type DealInput, type DealValues,
} from "@/lib/schemas/deal";

type FixedInstitution = { id: string; name: string };

/**
 * Open a deal. With `institution` the target is fixed (Institution 360); without it the user searches
 * for one (Sales). The new deal starts at Meeting; the database refuses a second open deal of the same type.
 */
export function NewDealButton({
  institution, label = "New deal", variant = "default",
}: { institution?: FixedInstitution; label?: string; variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><PlusIcon aria-hidden /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DealForm institution={institution} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DealForm({ institution, onDone }: { institution?: FixedInstitution; onDone: () => void }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<DealInput, unknown, DealValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      institution_id: institution?.id ?? "",
      kind: "workshop",
      title: "",
      value_inr: "",
      probability: String(STAGE_PROBABILITY.meeting),
      expected_close: "",
      owner_id: "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setServerError(null);
    const res = await createDeal(form.getValues());
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof DealInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Deal opened at Meeting");
    onDone();
    router.push(`/sales/${res.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>New deal</DialogTitle>
        <DialogDescription>
          {institution ? `Open a deal with ${institution.name}.` : "Open a deal with an institution. It starts at Meeting."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {!institution && (
          <Field data-invalid={!!errors.institution_id}>
            <FieldLabel htmlFor="deal-institution">Institution</FieldLabel>
            <Controller
              control={form.control}
              name="institution_id"
              render={({ field }) => <InstitutionPicker id="deal-institution" value={field.value} onChange={field.onChange} invalid={!!errors.institution_id} />}
            />
            <FieldError errors={[errors.institution_id]} />
          </Field>
        )}
        <Field data-invalid={!!errors.kind}>
          <FieldLabel htmlFor="deal-kind">Deal type</FieldLabel>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="deal-kind" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEAL_KINDS.map((k) => <SelectItem key={k} value={k}>{DEAL_KIND_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>An institution can have one open deal of each type at a time.</FieldDescription>
          <FieldError errors={[errors.kind]} />
        </Field>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="deal-title">Title (optional)</FieldLabel>
          <Input id="deal-title" autoComplete="off" placeholder="Filled in from the type and institution" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.value_inr}>
            <FieldLabel htmlFor="deal-value">Value (INR)</FieldLabel>
            <Input id="deal-value" inputMode="decimal" autoComplete="off" aria-invalid={!!errors.value_inr} {...form.register("value_inr")} />
            <FieldError errors={[errors.value_inr]} />
          </Field>
          <Field data-invalid={!!errors.probability}>
            <FieldLabel htmlFor="deal-probability">Chance (%)</FieldLabel>
            <Input id="deal-probability" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.probability} {...form.register("probability")} />
            <FieldError errors={[errors.probability]} />
          </Field>
          <Field data-invalid={!!errors.expected_close}>
            <FieldLabel htmlFor="deal-close">Expected close</FieldLabel>
            <Input id="deal-close" type="date" aria-invalid={!!errors.expected_close} {...form.register("expected_close")} />
            <FieldError errors={[errors.expected_close]} />
          </Field>
        </div>
        <FieldDescription>A free promotional workshop can stay at INR 0.</FieldDescription>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Open deal</Button>
      </DialogFooter>
    </form>
  );
}
