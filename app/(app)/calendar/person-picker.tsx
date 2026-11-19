"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Pick whose calendar to show. Each option carries a server-built link, so the URL stays the single source of truth. */
export function PersonPicker({ current, options }: { current: string; options: { id: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <Select value={current} onValueChange={(id) => { const o = options.find((x) => x.id === id); if (o) router.push(o.href); }}>
      <SelectTrigger className="w-56" aria-label="Whose calendar">
        <SelectValue placeholder="Choose a person" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
