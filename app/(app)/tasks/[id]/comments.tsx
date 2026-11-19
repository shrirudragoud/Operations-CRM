"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addTaskComment, deleteTaskComment } from "@/lib/actions/task";

export type CommentView = { id: string; body: string; at: string; author: string; canDelete: boolean };

type Person = { id: string; full_name: string };

export function Comments({ taskId, comments, canComment, people = [] }: { taskId: string; comments: CommentView[]; canComment: boolean; people?: Person[] }) {
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Person[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addTaskComment({ task_id: taskId, body, mentions: mentions.map((m) => m.id) });
      if (!res.ok) setError(res.fieldErrors?.body?.[0] ?? res.error);
      else {
        setBody("");
        setMentions([]);
      }
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
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form onSubmit={submit} noValidate className="space-y-2">
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="task-comment">Add a comment</FieldLabel>
            <Textarea id="task-comment" rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={!!error} />
            <FieldError errors={error ? [{ message: error }] : []} />
          </Field>
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
          <Button type="submit" size="sm" disabled={pending}>{pending && <Spinner />} Comment</Button>
        </form>
      )}
    </div>
  );
}
