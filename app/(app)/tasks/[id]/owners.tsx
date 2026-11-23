"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { XIcon } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import { PeoplePicker } from "@/components/people-picker";
import { addTaskOwner, removeTaskOwner } from "@/lib/actions/task";

export type OwnerView = { staffId: string; name: string };
type Option = { id: string; full_name: string };

/** The people who own a shared task together. Whoever finishes it finishes it for all. Managers add and remove owners. */
export function Owners({
  taskId, meId, owners, people, canManage, locked,
}: { taskId: string; meId: string; owners: OwnerView[]; people: Option[]; canManage: boolean; locked: boolean }) {
  const [pending, startTransition] = useTransition();
  const addable = people.filter((p) => !owners.some((o) => o.staffId === p.id));
  const editable = canManage && !locked;

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) toast.error(res.error);
      else toast.success(success);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2" aria-label="Owners">
        {owners.map((o) => (
          <li key={o.staffId} className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm">
            {o.staffId === meId ? `${o.name} (me)` : o.name}
            {editable && owners.length > 2 && (
              <Button
                type="button"
                className="flex size-6 items-center justify-center rounded-full p-0"
                aria-label={`Take ${o.name} off this task`}
                disabled={pending}
                onClick={() => run(() => removeTaskOwner({ task_id: taskId, staff_id: o.staffId }), `${o.name} is no longer an owner`)}
              >
                <XIcon aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && addable.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="add-owner" className="text-muted-foreground text-xs">Add an owner</label>
          <PeoplePicker
            id="add-owner"
            people={addable}
            meId={meId}
            value={[]}
            max={1}
            placeholder="Choose a person"
            onChange={(ids) => {
              const id = ids[0];
              if (id) run(() => addTaskOwner({ task_id: taskId, staff_id: id }), "Owner added");
            }}
          />
        </div>
      )}
      {locked && canManage && <p className="text-muted-foreground text-xs">Reopen the task to change its owners.</p>}
    </div>
  );
}
