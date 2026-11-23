"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { cn } from "cn";
import { TaskStatusChip } from "@/components/chips";
import type { SubPreview } from "@/lib/queries/tasks";
import { formatDue, isOverdue } from "@/lib/schemas/task";

const isOpen = (status: string) => status === "todo" || status === "doing" || status === "blocked";

/** A chevron under a parent that opens its subtasks in place: title, status, owner and deadline for each. */
export function SubtaskPeek({ title, subs }: { title: string; subs: SubPreview[] }) {
  const [open, setOpen] = useState(false);
  const done = subs.filter((s) => !isOpen(s.status)).length;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid gap-1.5">
      <CollapsibleTrigger
        draggable={false}
        aria-label={`Subtasks of ${title}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-fit items-center gap-1 rounded text-xs outline-none focus-visible:ring-2"
      >
        <ChevronRightIcon aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {done}/{subs.length} {subs.length === 1 ? "subtask" : "subtasks"} done
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="grid gap-1.5 border-l pl-3" aria-label={`Subtasks under ${title}`}>
          {subs.map((s) => {
            const late = isOverdue(s);
            return (
              <li key={s.id} className="grid gap-0.5 text-xs">
                <Link
                  href={`/tasks/${s.id}`}
                  draggable={false}
                  className={cn("leading-snug underline-offset-4 hover:underline", !isOpen(s.status) && "text-muted-foreground", s.status === "cancelled" && "line-through")}
                >
                  {s.title}
                </Link>
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <TaskStatusChip status={s.status} />
                  <span>{s.assignee ?? "Unassigned"}</span>
                  {s.due_date && <span className={cn(late && "font-medium text-red-600 dark:text-red-400")}>{late ? "Overdue, " : ""}{formatDue(s.due_date, s.due_time)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
