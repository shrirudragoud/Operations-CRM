"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addWatcher, removeWatcher } from "@/lib/actions/task-collab";

export type WatcherView = { staffId: string; name: string };
type Option = { id: string; full_name: string };

/** People who follow the task and get a notification when it changes. Anyone can follow it; managers add others. */
export function Watchers({
  taskId, meId, watchers, owners, canWrite, canManage,
}: { taskId: string; meId: string; watchers: WatcherView[]; owners: Option[]; canWrite: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState("");
  const watching = watchers.some((w) => w.staffId === meId);
  const addable = owners.filter((o) => !watchers.some((w) => w.staffId === o.id));

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) toast.error(res.error);
      else toast.success(success);
    });
  }

  return (
    <div className="space-y-3">
      {watchers.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody is watching yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Watchers">
          {watchers.map((w) => (
            <li key={w.staffId} className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm">
              {w.name}
              {(canManage || w.staffId === meId) && canWrite && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 rounded-full"
                  aria-label={`Stop ${w.name} watching`}
                  disabled={pending}
                  onClick={() => run(() => removeWatcher({ task_id: taskId, staff_id: w.staffId }), "Removed")}
                >
                  <XIcon aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="space-y-2">
          {watching ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => removeWatcher({ task_id: taskId, staff_id: meId }), "You stopped watching")}>
              <EyeOffIcon aria-hidden /> Stop watching
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => addWatcher({ task_id: taskId, staff_id: meId }), "You are watching this task")}>
              <EyeIcon aria-hidden /> Watch
            </Button>
          )}
          {canManage && addable.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="add-watcher" className="text-muted-foreground text-xs">Add a watcher</label>
              <Select
                value={pick}
                disabled={pending}
                onValueChange={(v) => {
                  setPick("");
                  run(() => addWatcher({ task_id: taskId, staff_id: v }), "Watcher added");
                }}
              >
                <SelectTrigger id="add-watcher" className="w-full"><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>
                  {addable.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
