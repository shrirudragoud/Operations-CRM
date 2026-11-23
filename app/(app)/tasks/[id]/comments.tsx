"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PaperclipIcon, Trash2Icon, XIcon } from "lucide-react";
import { FileInput, FileInputDropzone, FileInputTrigger } from "@ui-sdk/react/file-input";
import { FileList } from "@/components/tasks/file-views";
import { rejectionMessage, uploadTaskFiles } from "@/components/tasks/upload-task-files";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addTaskComment, deleteTaskComment } from "@/lib/actions/task";
import { formatBytes } from "@/lib/schemas/documents";
import { TASK_FILE_ACCEPT, TASK_FILE_MAX_BYTES } from "@/lib/schemas/task-files";
import type { FileView } from "@/lib/task-file-view";

export type CommentView = { id: string; body: string; at: string; author: string; canDelete: boolean; files: FileView[] };

const ACCEPT = TASK_FILE_ACCEPT.split(",");
const MAX_WITH_COMMENT = 10;

type Person = { id: string; full_name: string };

export function Comments({ taskId, comments, canComment, people = [] }: { taskId: string; comments: CommentView[]; canComment: boolean; people?: Person[] }) {
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Person[]>([]);
  const [pick, setPick] = useState("");
  const [attached, setAttached] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addTaskComment({ task_id: taskId, body, mentions: mentions.map((m) => m.id) });
      if (!res.ok) return void setError(res.fieldErrors?.body?.[0] ?? res.error);
      setBody("");
      setMentions([]);
      if (attached.length === 0) return;
      const sent = attached;
      setAttached([]);
      const failed = (await uploadTaskFiles(taskId, sent, { commentId: res.data.id })).filter((o) => o.error);
      if (failed.length > 0) setError(`Your comment was posted, but ${failed.map((o) => `${o.name} (${o.error})`).join("; ")} did not upload.`);
    });
  }

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm"><span className="font-medium">{c.author}</span> <span className="text-muted-foreground text-xs">{c.at}</span></p>
                {c.canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete comment"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteTaskComment({ id: c.id, task_id: taskId });
                        if (!res.ok) toast.error(res.error);
                      })
                    }
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                )}
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
              {c.files.length > 0 && (
                <div className="mt-2"><FileList files={c.files} layout="list" label={`Files on the comment by ${c.author}`} /></div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form onSubmit={submit} noValidate className="space-y-2">
          <FileInput
            multiple
            accept={ACCEPT}
            maxSize={TASK_FILE_MAX_BYTES}
            maxFiles={MAX_WITH_COMMENT}
            value={attached}
            onValueChange={(next) => setAttached(next)}
            onReject={(rejected) => setError(rejected.map((r) => `${r.file.name}: ${rejectionMessage(r.file as File)}`).join(" "))}
          >
            <FileInputDropzone pasteTarget="#task-comment" className="space-y-2">
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="task-comment">Add a comment</FieldLabel>
                <Textarea id="task-comment" rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={!!error} />
                <FieldError errors={error ? [{ message: error }] : []} />
              </Field>
            </FileInputDropzone>
            <FileInputTrigger type="button" className="inline-flex items-center gap-1.5 text-sm">
              <PaperclipIcon aria-hidden className="size-4" /> Attach files
            </FileInputTrigger>
          </FileInput>
          {people.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="comment-mention" className="text-muted-foreground text-xs">Mention someone (they are notified and start watching)</label>
              <Select
                value={pick}
                onValueChange={(v) => {
                  setPick("");
                  const person = people.find((p) => p.id === v);
                  if (person && !mentions.some((m) => m.id === v) && mentions.length < 10) setMentions([...mentions, person]);
                }}
              >
                <SelectTrigger id="comment-mention" className="w-full sm:w-64"><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>
                  {people.filter((p) => !mentions.some((m) => m.id === p.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {mentions.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Mentioned">
                  {mentions.map((m) => (
                    <li key={m.id} className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm">
                      @{m.full_name}
                      <Button type="button" variant="ghost" size="icon-sm" className="size-6 rounded-full" aria-label={`Don't mention ${m.full_name}`} onClick={() => setMentions(mentions.filter((x) => x.id !== m.id))}>
                        <XIcon aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {attached.length > 0 && (
            <ul className="space-y-1" aria-label="Files to attach">
              {attached.map((f, i) => (
                <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-sm">
                  <PaperclipIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(f.size)}</span>
                  <Button type="button" variant="ghost" size="icon-sm" className="size-6" aria-label={`Don't attach ${f.name}`} onClick={() => setAttached(attached.filter((_, j) => j !== i))}>
                    <XIcon aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button type="submit" size="sm" disabled={pending}>{pending && <Spinner />} Comment</Button>
        </form>
      )}
    </div>
  );
}
