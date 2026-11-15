"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import type { NavItem } from "@/lib/nav";

// Phase 0 stub: jumps between workspaces. Record search (institutions, deals, events) arrives in Phase 1.
export function CommandSearch({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground w-full max-w-64 justify-start gap-2 font-normal"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden />
        <span className="flex-1 text-left">Go to…</span>
        <kbd className="bg-muted hidden rounded px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Go to" description="Jump to a workspace">
        <CommandInput placeholder="Type a workspace name…" />
        <CommandList>
          <CommandEmpty>No matching workspace.</CommandEmpty>
          <CommandGroup heading="Workspaces">
            {items.map((item) => (
              <CommandItem
                key={item.href}
                value={item.label}
                onSelect={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
              >
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
