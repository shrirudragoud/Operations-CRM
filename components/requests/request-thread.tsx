"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentList, FilePicker } from "@/components/requests/attachments";
import { addRequestMessage, setRequestState } from "@/lib/actions/hr-requests";
import { formatDateTime } from "@/lib/format";
import type { ThreadMessage } from "@/lib/request-threads";
import { REQUEST_STATE_LABELS, type RequestState } from "@/lib/schemas/hr-requests";

export function StateBadge({ state }: { state: RequestState }) {
  const variant = state === "done" ? "default" : state === "rejected" ? "destructive" : state === "in_progress" ? "secondary" : "outline";
  return <Badge variant={variant}>{REQUEST_STATE_LABELS[state]}</Badge>;
}

export function RequestThread({
  requestId, subject, state, messages, hr,
}: { requestId: string; subject: string; state: RequestState; messages: ThreadMessage[]; hr: boolean }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [keepCopy, setKeepCopy] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closed = state === "done" || state === "rejected";
  const id = `rq-${requestId}`;

  function send(finish = false) {
    setError(null);
    const form = new FormData();
    form.set("request_id", requestId);
    form.set("body", body);
    form.set("internal", String(internal));
    form.set("finish", String(finish));
    form.set("keep_copy", String(hr && !internal && files.length > 0 && keepCopy));
    if (!internal) for (const f of files) form.append("files", f);
    start(async () => {
      const res = await addRequestMessage(form);
      if (!res.ok) return setError(res.error);
      toast.success(finish ? "Answer sent" : files.length > 0 ? "Sent with your files" : "Message sent");
      setBody("");
      setInternal(false);
      setFiles([]);
    });
  }

  function move(next: RequestState) {
    setError(null);
    start(async () => {
      const res = await setRequestState({ request_id: requestId, state: next, note });
      if (!res.ok) return setError(res.error);
      toast.success(`Marked ${REQUEST_STATE_LABELS[next].toLowerCase()}`);
      setNote("");
    });
  }

  return (
    <div className="grid gap-4">
      {messages.length > 0 && (
        <ul className="grid gap-2" aria-label={`Messages on ${subject}`}>
          {messages.map((m) => (
            <li key={m.id} className={`rounded-md border p-3 text-sm ${m.internal ? "border-dashed bg-muted/50" : ""}`}>
              <div className="text-muted-foreground flex items-center gap-2 pb-1 text-xs">
                <span className="font-medium">{m.author ?? "Someone"}</span>
                <span>{formatDateTime(m.created_at)}</span>
                {m.internal && <Badge variant="outline">Internal note</Badge>}
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
              {m.files.length > 0 && (
                <div className="pt-2"><AttachmentList files={m.files} label={`Files from ${m.author ?? "someone"}`} /></div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(!closed || hr) && (
        <div className="grid gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-body`}>Write a message</FieldLabel>
            <Textarea id={`${id}-body`} rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
          </Field>
          {hr && (
            <Field orientation="horizontal">
              <Checkbox id={`${id}-internal`} checked={internal} onCheckedChange={(on) => setInternal(on === true)} />
              <FieldLabel htmlFor={`${id}-internal`}>Internal note, the person won&apos;t see it</FieldLabel>
            </Field>
          )}
          {!internal && <FilePicker files={files} onChange={setFiles} disabled={pending} label={hr ? "Attach files for the person" : "Attach files for HR"} />}
          {hr && !internal && files.length > 0 && (
            <Field orientation="horizontal">
              <Checkbox id={`${id}-keep`} checked={keepCopy} onCheckedChange={(on) => setKeepCopy(on === true)} />
              <FieldLabel htmlFor={`${id}-keep`}>Also keep a copy in their documents</FieldLabel>
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send()} disabled={pending || (body.trim() === "" && files.length === 0)} className="w-fit" aria-label={`Send message on ${subject}`}>
              {pending && <Spinner />} {pending && files.length > 0 ? "Uploading" : "Send message"}
            </Button>
            {hr && !closed && !internal && (
              <Button variant="outline" onClick={() => send(true)} disabled={pending || (body.trim() === "" && files.length === 0)} aria-label={`Answer ${subject} with this reply`}>
                Send as the answer
              </Button>
            )}
          </div>
        </div>
      )}

      {hr && (
        <div className="grid gap-3 border-t pt-3">
          <Field>
            <FieldLabel htmlFor={`${id}-note`}>Note for the person (needed to reject)</FieldLabel>
            <Textarea id={`${id}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {state === "open" && <Button variant="outline" size="sm" onClick={() => move("in_progress")} disabled={pending}>Start working</Button>}
            {!closed && <Button size="sm" onClick={() => move("done")} disabled={pending} aria-label={`Mark ${subject} done`}>Mark done</Button>}
            {!closed && <Button variant="outline" size="sm" onClick={() => move("rejected")} disabled={pending || note.trim() === ""} aria-label={`Reject ${subject}`}>Reject</Button>}
            {closed && <Button variant="outline" size="sm" onClick={() => move("open")} disabled={pending}>Reopen</Button>}
          </div>
        </div>
      )}

      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
    </div>
  );
}
