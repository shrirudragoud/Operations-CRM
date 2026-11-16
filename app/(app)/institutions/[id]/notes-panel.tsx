"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { updateInstitutionNotes } from "@/lib/actions/institution";

const MAX = 4000;

export function NotesPanel({ id, notes, canEdit }: { id: string; notes: string | null; canEdit: boolean }) {
  const [value, setValue] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return notes ? (
      <p className="max-w-3xl whitespace-pre-wrap">{notes}</p>
    ) : (
      <p className="text-muted-foreground">No notes yet.</p>
    );
  }

  const dirty = value.trim() !== (notes ?? "").trim();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateInstitutionNotes({ id, notes: value });
      if (!res.ok) {
        setError(res.fieldErrors?.notes?.[0] ?? res.error);
        return;
      }
      toast.success("Notes saved");
    });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Field>
        <FieldLabel htmlFor="inst-notes-edit">Notes</FieldLabel>
        <Textarea
          id="inst-notes-edit"
          rows={8}
          value={value}
          maxLength={MAX}
          onChange={(e) => setValue(e.target.value)}
        />
        <FieldDescription>{value.length} / {MAX} characters. Shared with everyone who can see this institution.</FieldDescription>
      </Field>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={save} disabled={pending || !dirty}>
        {pending && <Spinner />} Save notes
      </Button>
    </div>
  );
}
