"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { saveHrProfile } from "@/lib/actions/profile";
import { EMPLOYMENT_LABELS, EMPLOYMENT_TYPES, hrProfileSchema, type HrProfile, type HrProfileInput } from "@/lib/schemas/profile";

const NONE = "none";

export function HrForm({ defaults, managers }: { defaults: HrProfileInput; managers: { id: string; full_name: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<HrProfileInput, unknown, HrProfile>({ resolver: zodResolver(hrProfileSchema), defaultValues: defaults });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setError(null);
    const res = await saveHrProfile(form.getValues());
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("Record saved");
    form.reset(form.getValues());
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-2xl">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.employee_code}>
            <FieldLabel htmlFor="hr-code">Employee code</FieldLabel>
            <Input id="hr-code" autoComplete="off" aria-invalid={!!errors.employee_code} {...form.register("employee_code")} />
            <FieldError errors={[errors.employee_code]} />
          </Field>
          <Field data-invalid={!!errors.designation}>
            <FieldLabel htmlFor="hr-designation">Designation</FieldLabel>
            <Input id="hr-designation" autoComplete="off" aria-invalid={!!errors.designation} {...form.register("designation")} />
            <FieldError errors={[errors.designation]} />
          </Field>
          <Field data-invalid={!!errors.joined_on}>
            <FieldLabel htmlFor="hr-joined">Joined on</FieldLabel>
            <Input id="hr-joined" type="date" aria-invalid={!!errors.joined_on} {...form.register("joined_on")} />
            <FieldError errors={[errors.joined_on]} />
          </Field>
          <Field data-invalid={!!errors.probation_end}>
            <FieldLabel htmlFor="hr-probation">Probation ends</FieldLabel>
            <Input id="hr-probation" type="date" aria-invalid={!!errors.probation_end} {...form.register("probation_end")} />
            <FieldError errors={[errors.probation_end]} />
          </Field>
          <Field data-invalid={!!errors.employment_type}>
            <FieldLabel htmlFor="hr-type">Employment type</FieldLabel>
            <Controller
              control={form.control}
              name="employment_type"
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger id="hr-type" className="w-full" aria-label="Employment type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{EMPLOYMENT_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.employment_type]} />
          </Field>
          <Field data-invalid={!!errors.manager_id}>
            <FieldLabel htmlFor="hr-manager">Manager</FieldLabel>
            <Controller
              control={form.control}
              name="manager_id"
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger id="hr-manager" className="w-full" aria-label="Manager"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No manager</SelectItem>
                    {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.manager_id]} />
          </Field>
        </div>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={isSubmitting} className="w-fit">{isSubmitting && <Spinner />} Save record</Button>
      </FieldGroup>
    </form>
  );
}
