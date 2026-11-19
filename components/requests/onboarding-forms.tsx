"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { addTemplateItem, deleteTemplateItem, setTemplateActive, startOnboarding } from "@/lib/actions/hr-requests";
import { ONBOARDING_KINDS, ONBOARDING_LABELS, OWNERS, OWNER_LABELS, type OnboardingKind, type OnboardingOwner } from "@/lib/schemas/hr-requests";

export function StartForm({ people }: { people: { id: string; full_name: string }[] }) {
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState<OnboardingKind>("joiner");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await startOnboarding({ staff_id: person, kind, date });
      if (!res.ok) return setError(res.error);
      toast.success(`Checklist started with ${res.data.items} steps`);
      setPerson("");
    });
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="ob-person">Person</FieldLabel>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger id="ob-person" aria-label="Person"><SelectValue placeholder="Choose a person" /></SelectTrigger>
              <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ob-kind">Checklist</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v as OnboardingKind)}>
              <SelectTrigger id="ob-kind" aria-label="Checklist"><SelectValue /></SelectTrigger>
              <SelectContent>{ONBOARDING_KINDS.map((k) => <SelectItem key={k} value={k}>{ONBOARDING_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ob-date">{kind === "joiner" ? "First day" : "Last day"}</FieldLabel>
            <Input id="ob-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={pending || !person} className="w-fit">{pending && <Spinner />} Start checklist</Button>
      </FieldGroup>
    </form>
  );
}

export function TemplateForm() {
  const [kind, setKind] = useState<OnboardingKind>("joiner");
  const [owner, setOwner] = useState<OnboardingOwner>("hr");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [offset, setOffset] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addTemplateItem({ kind, title, detail, owner, due_offset: offset });
      if (!res.ok) return setError(res.error);
      toast.success("Step added");
      setTitle("");
      setDetail("");
    });
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="tp-kind">Which checklist</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v as OnboardingKind)}>
              <SelectTrigger id="tp-kind" aria-label="Which checklist"><SelectValue /></SelectTrigger>
              <SelectContent>{ONBOARDING_KINDS.map((k) => <SelectItem key={k} value={k}>{ONBOARDING_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="tp-owner">Who does it</FieldLabel>
            <Select value={owner} onValueChange={(v) => setOwner(v as OnboardingOwner)}>
              <SelectTrigger id="tp-owner" aria-label="Who does it"><SelectValue /></SelectTrigger>
              <SelectContent>{OWNERS.map((o) => <SelectItem key={o} value={o}>{OWNER_LABELS[o]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="tp-offset">Days from the {kind === "joiner" ? "first" : "last"} day</FieldLabel>
            <Input id="tp-offset" type="number" min={-60} max={60} value={offset} onChange={(e) => setOffset(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="tp-title">Step</FieldLabel>
          <Input id="tp-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor="tp-detail">Detail (optional)</FieldLabel>
          <Input id="tp-detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={500} autoComplete="off" />
        </Field>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={pending || title.trim() === ""} className="w-fit">{pending && <Spinner />} Add step</Button>
      </FieldGroup>
    </form>
  );
}

export function TemplateRowActions({ id, title, active }: { id: string; title: string; active: boolean }) {
  const [pending, start] = useTransition();
  function toggle(on: boolean) {
    start(async () => {
      const res = await setTemplateActive({ id, is_active: on });
      if (!res.ok) toast.error(res.error);
    });
  }
  function remove() {
    start(async () => {
      const res = await deleteTemplateItem(id);
      if (!res.ok) toast.error(res.error);
      else toast.success(`${title} was removed`);
    });
  }
  return (
    <div className="flex items-center justify-end gap-3">
      <Switch checked={active} onCheckedChange={toggle} disabled={pending} aria-label={`Use ${title}`} />
      <Button variant="ghost" size="sm" onClick={remove} disabled={pending} aria-label={`Delete ${title}`}><Trash2Icon aria-hidden /></Button>
    </div>
  );
}
