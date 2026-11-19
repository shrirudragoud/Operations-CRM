"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { publishCompanyDocument, uploadMyDocument, uploadStaffDocument } from "@/lib/actions/documents";
import {
  AUDIENCES, AUDIENCE_LABELS, COMPANY_DOC_KINDS, COMPANY_DOC_LABELS, OWN_DOC_KINDS, STAFF_DOC_KINDS, STAFF_DOC_LABELS, UPLOAD_ACCEPT, checkUpload,
} from "@/lib/schemas/documents";

type Mode =
  | { mode: "own" }
  | { mode: "for_person"; people: { id: string; full_name: string }[] }
  | { mode: "publish" };

export function UploadForm(props: Mode) {
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<string>(props.mode === "publish" ? "policy" : "id_proof");
  const [audience, setAudience] = useState<string>("everyone");
  const [person, setPerson] = useState<string>("");

  const kinds = props.mode === "own" ? OWN_DOC_KINDS : STAFF_DOC_KINDS;
  const heading = props.mode === "publish" ? "Publish document" : "Upload document";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    const check = checkUpload(file);
    if (!check.ok) return setError(check.error);
    data.set("kind", kind);
    if (props.mode === "publish") data.set("audience", audience);
    if (props.mode === "for_person") {
      if (!person) return setError("Choose whose document this is.");
      data.set("staff_id", person);
    }
    start(async () => {
      const act = props.mode === "own" ? uploadMyDocument : props.mode === "publish" ? publishCompanyDocument : uploadStaffDocument;
      const res = await act(data);
      if (!res.ok) return setError(res.error);
      toast.success(props.mode === "publish" ? "Published" : "Document uploaded");
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="max-w-2xl">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          {props.mode === "for_person" && (
            <Field>
              <FieldLabel htmlFor={`${uid}-person`}>Whose document</FieldLabel>
              <Select value={person} onValueChange={setPerson}>
                <SelectTrigger id={`${uid}-person`} aria-label="Whose document"><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>
                  {props.people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor={`${uid}-title`}>Title</FieldLabel>
            <Input id={`${uid}-title`} name="title" autoComplete="off" maxLength={140} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-kind`}>Type</FieldLabel>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id={`${uid}-kind`} aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {props.mode === "publish"
                  ? COMPANY_DOC_KINDS.map((k) => <SelectItem key={k} value={k}>{COMPANY_DOC_LABELS[k]}</SelectItem>)
                  : kinds.map((k) => <SelectItem key={k} value={k}>{STAFF_DOC_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {props.mode === "publish" ? (
            <Field>
              <FieldLabel htmlFor={`${uid}-audience`}>Who it is for</FieldLabel>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger id={`${uid}-audience`} aria-label="Who it is for"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIENCES.map((a) => <SelectItem key={a} value={a}>{AUDIENCE_LABELS[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor={`${uid}-expires`}>Expires on (optional)</FieldLabel>
              <Input id={`${uid}-expires`} name="expires_on" type="date" />
            </Field>
          )}
        </div>
        {props.mode === "publish" && (
          <Field>
            <FieldLabel htmlFor={`${uid}-summary`}>What changed or what it covers (optional)</FieldLabel>
            <Textarea id={`${uid}-summary`} name="summary" rows={2} maxLength={500} />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${uid}-file`}>File</FieldLabel>
          <Input id={`${uid}-file`} name="file" type="file" accept={UPLOAD_ACCEPT} />
          <FieldDescription>A PDF or an image (JPG, PNG, WebP), up to 10 MB.</FieldDescription>
        </Field>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? <Spinner /> : <UploadIcon aria-hidden />} {heading}
        </Button>
      </FieldGroup>
    </form>
  );
}
