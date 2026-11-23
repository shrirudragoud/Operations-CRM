"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { sendFileToPerson } from "@/lib/actions/hr-send";
import { STAFF_DOC_KINDS, STAFF_DOC_LABELS, UPLOAD_ACCEPT, checkUpload } from "@/lib/schemas/documents";

export function SendFileForm({ people }: { people: { id: string; full_name: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState("other");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    if (!person) return setError("Choose who this is for.");
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to send.");
    const check = checkUpload(file);
    if (!check.ok) return setError(check.error);
    data.set("staff_id", person);
    data.set("kind", kind);
    start(async () => {
      const res = await sendFileToPerson(data);
      if (!res.ok) return setError(res.error);
      const name = people.find((p) => p.id === person)?.full_name ?? "them";
      toast.success(`Sent to ${name}`);
      formRef.current?.reset();
      setPerson("");
      setKind("other");
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-label="Send a file to a person">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${uid}-person`}>Send to</FieldLabel>
          <Select value={person} onValueChange={setPerson}>
            <SelectTrigger id={`${uid}-person`} aria-label="Send to"><SelectValue placeholder="Choose a person" /></SelectTrigger>
            <SelectContent>
              {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${uid}-title`}>Title</FieldLabel>
            <Input id={`${uid}-title`} name="title" autoComplete="off" maxLength={120} placeholder="Experience letter" />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-kind`}>Kind of file</FieldLabel>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id={`${uid}-kind`} aria-label="Kind of file"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAFF_DOC_KINDS.map((k) => <SelectItem key={k} value={k}>{STAFF_DOC_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${uid}-note`}>Note (optional)</FieldLabel>
          <Input id={`${uid}-note`} name="note" autoComplete="off" maxLength={300} placeholder="Shown in their notification" />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-file`}>File</FieldLabel>
          <Input id={`${uid}-file`} name="file" type="file" accept={UPLOAD_ACCEPT} />
          <FieldDescription>A PDF or an image (JPG, PNG, WebP), up to 10 MB. It goes onto their documents, marked verified, and they get a notification.</FieldDescription>
        </Field>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? <Spinner /> : <SendIcon aria-hidden />} Send file
        </Button>
      </FieldGroup>
    </form>
  );
}
