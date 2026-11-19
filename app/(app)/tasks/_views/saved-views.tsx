"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BookmarkIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { deleteTaskView, saveTaskView } from "@/lib/actions/task-collab";

export type SavedView = { id: string; owner_id: string; name: string; query: string; shared: boolean };

/** "Views": jump to a saved set of filters, remove your own, or save the current filters (and layout) under a name. */
export function SavedViews({
  views, meId, currentQuery, canSave,
}: { views: SavedView[]; meId: string; currentQuery: string; canSave: boolean }) {
  const [pending, startTransition] = useTransition();

  function remove(v: SavedView) {
    startTransition(async () => {
      const res = await deleteTaskView({ id: v.id });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Removed "${v.name}"`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm"><BookmarkIcon aria-hidden /> Views{views.length > 0 && ` (${views.length})`}</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2">
          {views.length === 0 ? (
            <p className="text-muted-foreground p-2 text-sm">No saved views yet. Set the filters you want, then choose Save this view.</p>
          ) : (
            <ul aria-label="Saved views" className="space-y-0.5">
              {views.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-1">
                  <Link href={v.query ? `/tasks?${v.query}` : "/tasks"} className="hover:bg-accent flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-sm">
                    <span className="truncate">{v.name}</span>
                    {v.shared && <UsersIcon className="text-muted-foreground size-3.5 shrink-0" aria-label="Shared with the team" />}
                  </Link>
                  {v.owner_id === meId && (
                    <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Remove view ${v.name}`} onClick={() => remove(v)}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {canSave && <SaveDialog currentQuery={currentQuery} />}
    </div>
  );
}

function SaveDialog({ currentQuery }: { currentQuery: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Save this view</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open && <SaveForm currentQuery={currentQuery} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SaveForm({ currentQuery, onDone }: { currentQuery: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = await saveTaskView({ name, query: currentQuery, shared });
      if (!res.ok) {
        const msg = res.fieldErrors?.name?.[0];
        if (msg) setFieldError(msg);
        else setError(res.error);
        return;
      }
      toast.success("View saved");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>Save this view</DialogTitle>
        <DialogDescription>Keeps the current list, layout, filters and search so you can come back to them in one click.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!fieldError}>
        <FieldLabel htmlFor="view-name">Name</FieldLabel>
        <Input id="view-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldError} placeholder="e.g. Blocked in Workshop" />
        <FieldError errors={fieldError ? [{ message: fieldError }] : []} />
      </Field>
      <div className="flex items-center gap-2">
        <Switch id="view-shared" checked={shared} onCheckedChange={setShared} />
        <label htmlFor="view-shared" className="text-sm">Share with the team</label>
      </div>
      {error && (
        <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Back</Button>
        <Button type="submit" disabled={pending}>{pending && <Spinner />} Save view</Button>
      </DialogFooter>
    </form>
  );
}
