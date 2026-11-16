"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchInstitutions, type InstitutionOption } from "@/lib/actions/activity";

/** Type-ahead institution picker (Outreach and Sales forms). Searches on the server; RLS limits a partner to their own. */
export function InstitutionPicker({
  id, value, onChange, invalid,
}: { id: string; value: string; onChange: (id: string, institution: InstitutionOption) => void; invalid: boolean }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<InstitutionOption[]>([]);
  const [picked, setPicked] = useState<InstitutionOption | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await searchInstitutions(term);
      if (stale) return;
      setLoadError(!res.ok);
      if (res.ok) setOptions(res.data);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [term, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className="w-full justify-between font-normal"
        >
          <span className={picked && value ? "" : "text-muted-foreground"}>
            {picked && value ? picked.name : "Search institutions…"}
          </span>
          <ChevronsUpDownIcon aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type a name or city…" value={term} onValueChange={setTerm} />
          <CommandList>
            <CommandEmpty>{loadError ? "Couldn't search. Try again." : "No institution found."}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    setPicked(o);
                    onChange(o.id, o);
                    setOpen(false);
                  }}
                >
                  <div className="flex-1">
                    <div>{o.name}</div>
                    {o.city && <div className="text-muted-foreground text-xs">{o.city}</div>}
                  </div>
                  {o.id === value && <CheckIcon aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
