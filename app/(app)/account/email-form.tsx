"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { saveEmailPrefs, sendTestEmail } from "@/lib/actions/email";
import { EMAIL_GROUPS, type EmailGroupId } from "@/lib/schemas/email";

export function EmailForm({ email, initial }: { email: string; initial: { enabled: boolean; groups: EmailGroupId[] } }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [groups, setGroups] = useState<EmailGroupId[]>(initial.groups);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  const toggle = (id: EmailGroupId, on: boolean) => setGroups((g) => (on ? [...new Set([...g, id])] : g.filter((x) => x !== id)));

  const save = () =>
    startSave(async () => {
      const r = await saveEmailPrefs({ enabled, groups });
      if (r.ok) toast.success("Email choices saved");
      else toast.error(r.error);
    });

  const test = () =>
    startTest(async () => {
      const r = await sendTestEmail();
      if (r.ok) toast.success(`A test email is on its way to ${email}. It can take a minute.`);
      else toast.error(r.error);
    });

  return (
    <FieldGroup className="max-w-md">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="email-enabled">Send me email</FieldLabel>
          <FieldDescription className="break-all">To {email}</FieldDescription>
        </FieldContent>
        <Switch id="email-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </Field>

      <FieldSeparator />

      <FieldSet disabled={!enabled}>
        <FieldLegend variant="label">What to email me about</FieldLegend>
        <FieldGroup className="gap-4">
          {EMAIL_GROUPS.map((g) => (
            <Field key={g.id} orientation="horizontal" data-disabled={!enabled}>
              <Checkbox
                id={`email-${g.id}`}
                checked={groups.includes(g.id)}
                disabled={!enabled}
                onCheckedChange={(on) => toggle(g.id, on === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor={`email-${g.id}`}>{g.label}</FieldLabel>
                <FieldDescription>{g.hint}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>

      <Field orientation="horizontal" className="flex-wrap">
        <Button type="button" onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
        <Button type="button" variant="outline" onClick={test} disabled={testing}>{testing && <Spinner />} Send a test email</Button>
      </Field>
    </FieldGroup>
  );
}
