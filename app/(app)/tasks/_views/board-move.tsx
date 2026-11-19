"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/schemas/activity";
import { allowedTaskMoves } from "@/lib/schemas/task";

/** The keyboard and phone way to move a card: dragging does not work with a keyboard or a finger. */
export function BoardMove({ title, status, onMove }: { title: string; status: TaskStatus; onMove: (to: TaskStatus) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1.5 shrink-0" aria-label={`Move: ${title}`}>
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {allowedTaskMoves(status).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onMove(s)}>{TASK_STATUS_LABELS[s]}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
