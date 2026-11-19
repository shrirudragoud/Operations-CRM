"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { id: string; full_name: string };

/** Leads and the founder look at a teammate's week; the page stays read-only for it. */
export function PersonPicker({ week, current, meId, people }: { week: string; current: string; meId: string; people: Option[] }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="timesheet-person" className="text-muted-foreground text-sm">Person</label>
      <Select
        value={current}
        onValueChange={(v) => {
          const q = new URLSearchParams({ week });
          if (v !== meId) q.set("person", v);
          router.push(`/timesheet?${q.toString()}`);
        }}
      >
        <SelectTrigger id="timesheet-person" className="w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.id === meId ? `${p.full_name} (me)` : p.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
