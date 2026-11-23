"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLinkIcon, PaperclipIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { openRequestFile } from "@/lib/actions/hr-requests";
import type { Attachment } from "@/lib/request-threads";
import { formatBytes, UPLOAD_ACCEPT } from "@/lib/schemas/documents";
import { checkAttachments, MAX_FILES_PER_MESSAGE } from "@/lib/schemas/hr-requests";

function OpenFileButton({ file }: { file: Attachment }) {
  const [pending, start] = useTransition();
  function open() {
    start(async () => {
      const res = await openRequestFile(file.id);
      if (!res.ok) return void toast.error(res.error);
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    });
  }
  return (
    <Button variant="outline" size="sm" onClick={open} disabled={pending} aria-label={`Open ${file.name}`}>
      {pending ? <Spinner /> : <ExternalLinkIcon aria-hidden />} Open
    </Button>
  );
}

/** The files on a request or a message: name, size and an Open button each. */
export function AttachmentList({ files, label }: { files: Attachment[]; label: string }) {
  if (files.length === 0) return null;
  return (
    <ul className="grid gap-1.5" aria-label={label}>
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
          <PaperclipIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(f.size_bytes)}</span>
          <OpenFileButton file={f} />
        </li>
      ))}
    </ul>
  );
}

/** Choosing files to send. The parent owns the list so it can put the files in the form it submits. */
export function FilePicker({
  files, onChange, disabled = false, label = "Attach files", error,
}: { files: File[]; onChange: (next: File[]) => void; disabled?: boolean; label?: string; error?: string | null }) {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);

  function add(e: React.ChangeEvent<HTMLInputElement>) {
    const next = [...files, ...Array.from(e.target.files ?? [])];
    e.target.value = "";
    const bad = checkAttachments(next);
    setProblem(bad);
    if (!bad) onChange(next);
  }

  return (
    <Field>
      <FieldLabel htmlFor={`${id}-files`}>{label}</FieldLabel>
      <Input id={`${id}-files`} type="file" multiple accept={UPLOAD_ACCEPT} onChange={add} disabled={disabled} aria-describedby={`${id}-help`} />
      <FieldDescription id={`${id}-help`}>Up to {MAX_FILES_PER_MESSAGE} files. Each a PDF or an image (JPG, PNG, WebP), up to 10 MB.</FieldDescription>
      {(problem ?? error) && <p className="text-destructive text-sm" role="alert">{problem ?? error}</p>}
      {files.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Files to send">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
              <PaperclipIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(f.size)}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}
