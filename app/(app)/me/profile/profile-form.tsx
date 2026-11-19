"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { saveMyProfile } from "@/lib/actions/profile";
import { BLOOD_GROUPS, personalProfileSchema, type PersonalProfile, type PersonalProfileInput } from "@/lib/schemas/profile";

const NONE = "none";

export function ProfileForm({ defaults }: { defaults: PersonalProfileInput }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PersonalProfileInput, unknown, PersonalProfile>({ resolver: zodResolver(personalProfileSchema), defaultValues: defaults });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setError(null);
    const res = await saveMyProfile(form.getValues());
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("Profile saved");
    form.reset(form.getValues());
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-2xl">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.legal_name}>
            <FieldLabel htmlFor="pf-legal-name">Legal name</FieldLabel>
            <Input id="pf-legal-name" autoComplete="name" aria-invalid={!!errors.legal_name} {...form.register("legal_name")} />
            <FieldError errors={[errors.legal_name]} />
          </Field>
          <Field data-invalid={!!errors.birth_date}>
            <FieldLabel htmlFor="pf-birth-date">Date of birth</FieldLabel>
            <Input id="pf-birth-date" type="date" autoComplete="bday" aria-invalid={!!errors.birth_date} {...form.register("birth_date")} />
            <FieldError errors={[errors.birth_date]} />
          </Field>
          <Field data-invalid={!!errors.personal_email}>
            <FieldLabel htmlFor="pf-personal-email">Personal email</FieldLabel>
            <Input id="pf-personal-email" type="email" autoComplete="email" aria-invalid={!!errors.personal_email} {...form.register("personal_email")} />
            <FieldError errors={[errors.personal_email]} />
          </Field>
          <Field data-invalid={!!errors.personal_phone}>
            <FieldLabel htmlFor="pf-personal-phone">Personal phone</FieldLabel>
            <Input id="pf-personal-phone" type="tel" autoComplete="tel" aria-invalid={!!errors.personal_phone} {...form.register("personal_phone")} />
            <FieldError errors={[errors.personal_phone]} />
          </Field>
        </div>

        <Field data-invalid={!!errors.address}>
          <FieldLabel htmlFor="pf-address">Address</FieldLabel>
          <Textarea id="pf-address" rows={3} autoComplete="street-address" aria-invalid={!!errors.address} {...form.register("address")} />
          <FieldError errors={[errors.address]} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.emergency_name}>
            <FieldLabel htmlFor="pf-emergency-name">Emergency contact</FieldLabel>
            <Input id="pf-emergency-name" autoComplete="off" aria-invalid={!!errors.emergency_name} {...form.register("emergency_name")} />
            <FieldError errors={[errors.emergency_name]} />
          </Field>
          <Field data-invalid={!!errors.emergency_phone}>
            <FieldLabel htmlFor="pf-emergency-phone">Emergency phone</FieldLabel>
            <Input id="pf-emergency-phone" type="tel" autoComplete="off" aria-invalid={!!errors.emergency_phone} {...form.register("emergency_phone")} />
            <FieldError errors={[errors.emergency_phone]} />
          </Field>
          <Field data-invalid={!!errors.emergency_relation}>
            <FieldLabel htmlFor="pf-emergency-relation">Relationship</FieldLabel>
            <Input id="pf-emergency-relation" autoComplete="off" aria-invalid={!!errors.emergency_relation} {...form.register("emergency_relation")} />
            <FieldError errors={[errors.emergency_relation]} />
          </Field>
        </div>

        <Field data-invalid={!!errors.blood_group}>
          <FieldLabel htmlFor="pf-blood-group">Blood group</FieldLabel>
          <Controller
            control={form.control}
            name="blood_group"
            render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                <SelectTrigger id="pf-blood-group" className="w-40" aria-label="Blood group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.blood_group]} />
        </Field>

        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="birthday_visible"
            render={({ field }) => (
              <Checkbox id="pf-birthday-visible" checked={field.value} onCheckedChange={(on) => field.onChange(on === true)} />
            )}
          />
          <div>
            <FieldLabel htmlFor="pf-birthday-visible">Show my birthday to colleagues</FieldLabel>
            <FieldDescription>Only the day and month are shown, never the year. Leave it off to keep your birthday private.</FieldDescription>
          </div>
        </Field>

        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={isSubmitting} className="w-fit">{isSubmitting && <Spinner />} Save profile</Button>
      </FieldGroup>
    </form>
  );
}
