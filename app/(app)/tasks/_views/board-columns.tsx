"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ClockIcon, ListChecksIcon, MessageSquareIcon, EyeIcon } from "lucide-react";
import { cn } from "cn";
import { DepartmentChip, HealthChip, PriorityChip, STATUS_ICON } from "@/components/chips";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { changeTaskStatus } from "@/lib/actions/task";
import { initials } from "@/lib/format";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/schemas/activity";
import { allowedTaskMoves, formatMinutes } from "@/lib/schemas/task";
import { PRIORITY_TONE, TASK_STATUS_TONE, TONE_PANEL, TONE_SOLID, TONE_STRIPE } from "@/lib/tone";
import type { Health } from "@/lib/task-health";
import { BoardMove } from "./board-move";

export type BoardCard = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  department: string | null;
  assignee: string | null;
  health: Health;
  span: string;
  hasDates: boolean;
  estimate: number | null;
  movable: boolean;
  subOpen: number;
  subTotal: number;
  watchers: number;
  comments: number;
  logged: number;
};

type Pending = { card: BoardCard; to: "blocked" | "cancelled" };

export function BoardColumns({ cards, columns, recentDone, create }: { cards: BoardCard[]; columns: TaskStatus[]; recentDone: boolean; create?: ReactNode }) {
  const [shown, setShown] = useOptimistic(cards, (cur, m: { id: string; status: TaskStatus }) => cur.map((c) => (c.id === m.id ? { ...c, status: m.status } : c)));
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  function send(card: BoardCard, to: TaskStatus, reason = "") {
    startTransition(async () => {
      setShown({ id: card.id, status: to });
      const res = await changeTaskStatus({ id: card.id, status: to, reason });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Moved to ${TASK_STATUS_LABELS[to]}`);
    });
  }

  function request(card: BoardCard, to: TaskStatus) {
    if (to === card.status) return;
    if (!card.movable) return void toast.error("You can not move that task.");
    if (!allowedTaskMoves(card.status).includes(to)) {
      return void toast.error(`A ${TASK_STATUS_LABELS[card.status].toLowerCase()} task can not go straight to ${TASK_STATUS_LABELS[to]}.`);
    }
    if (to === "blocked" || to === "cancelled") setPending({ card, to });
    else send(card, to);
  }

  function drop(e: DragEvent, to: TaskStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setOver(null);
    setDragId(null);
    const card = shown.find((c) => c.id === id);
    if (card) request(card, to);
  }

  return (
    <>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {columns.map((status) => {
          const items = shown.filter((c) => c.status === status);
          const tone = TASK_STATUS_TONE[status] ?? "slate";
          const Icon = STATUS_ICON[status];
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABELS[status]}
              onDragOver={(e) => { e.preventDefault(); setOver(status); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === status ? null : o)); }}
              onDrop={(e) => drop(e, status)}
              className={cn("flex min-w-64 flex-1 basis-0 flex-col overflow-hidden rounded-lg border", TONE_PANEL[tone], over === status && "ring-primary ring-2")}
            >
              <div className={cn("h-1", TONE_SOLID[tone])} />
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                {Icon && <Icon aria-hidden className="text-muted-foreground size-4" />}
                <h2 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h2>
                <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
              </div>
              {status === "done" && recentDone && <p className="text-muted-foreground -mt-1 px-3 pb-1 text-xs">Finished in the last 14 days</p>}
              <ul className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {items.map((c) => <Card key={c.id} card={c} dragging={dragId === c.id} onDragStart={() => setDragId(c.id)} onDragEnd={() => { setDragId(null); setOver(null); }} onMove={(to) => request(c, to)} />)}
                {items.length === 0 && (
                  <li className="text-muted-foreground rounded-md border border-dashed px-2 py-6 text-center text-xs">
                    {dragId ? "Drop here" : "Nothing here."}
                  </li>
                )}
              </ul>
              {status === "todo" && create && <div className="border-t px-2 py-1.5">{create}</div>}
            </section>
          );
        })}
      </div>
      <ReasonDialog pending={pending} onClose={() => setPending(null)} onSubmit={(reason) => { if (pending) send(pending.card, pending.to, reason); setPending(null); }} />
    </>
  );
}

function Card({ card: c, dragging, onDragStart, onDragEnd, onMove }: {
  card: BoardCard; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onMove: (to: TaskStatus) => void;
}) {
  const finished = c.status === "done" || c.status === "cancelled";
  const over = c.estimate !== null && c.logged > c.estimate;
  return (
    <li
      draggable={c.movable}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={cn(
        "bg-card space-y-2 rounded-md border border-l-4 p-2.5 shadow-xs",
        TONE_STRIPE[c.health.level > 0 ? c.health.tone : (PRIORITY_TONE[c.priority] ?? "slate")],
        c.health.level >= 2 && TONE_PANEL[c.health.tone],
        c.movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        finished && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <Link href={`/tasks/${c.id}`} draggable={false} className={cn("text-sm leading-snug font-medium underline-offset-4 hover:underline", c.status === "cancelled" && "line-through")}>{c.title}</Link>
        {c.movable && <BoardMove title={c.title} status={c.status} onMove={onMove} />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityChip priority={c.priority} />
        {c.health.key !== "finished" && c.health.key !== "no_date" && <HealthChip health={c.health} />}
        {c.hasDates && <span className="text-muted-foreground text-xs">{c.span}</span>}
        <DepartmentChip department={c.department} />
      </div>
      {c.subTotal > 0 && (
        <div className="flex items-center gap-2" aria-label={`${c.subTotal - c.subOpen} of ${c.subTotal} subtasks done`}>
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(((c.subTotal - c.subOpen) / c.subTotal) * 100)}%` }} />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">{c.subTotal - c.subOpen}/{c.subTotal}</span>
        </div>
      )}
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        {c.assignee ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar size="sm"><AvatarFallback className="text-[10px]">{initials(c.assignee)}</AvatarFallback></Avatar>
            <span className="truncate">{c.assignee.split(" ")[0]}</span>
          </span>
        ) : (
          <span className="italic">Unassigned</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {(c.estimate !== null || c.logged > 0) && (
            <span className={cn("flex items-center gap-1", over && "font-medium text-red-600 dark:text-red-400")} title="Time logged / estimate">
              <ClockIcon aria-hidden className="size-3" />
              {c.logged ? formatMinutes(c.logged) : "0m"}{c.estimate !== null && ` / ${formatMinutes(c.estimate)}`}
            </span>
          )}
          {c.subTotal > 0 && <span className="flex items-center gap-1" title="Subtasks"><ListChecksIcon aria-hidden className="size-3" />{c.subTotal}</span>}
          {c.comments > 0 && <span className="flex items-center gap-1" title="Comments"><MessageSquareIcon aria-hidden className="size-3" />{c.comments}</span>}
          {c.watchers > 0 && <span className="flex items-center gap-1" title="Watchers"><EyeIcon aria-hidden className="size-3" />{c.watchers}</span>}
        </span>
      </div>
    </li>
  );
}

function ReasonDialog({ pending, onClose, onSubmit }: { pending: Pending | null; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const blocked = pending?.to === "blocked";
  return (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            onSubmit(reason.trim());
            setReason("");
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{blocked ? "Mark as blocked" : "Cancel this task"}</DialogTitle>
            <DialogDescription>{pending?.card.title}</DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={blocked ? "What is blocking it" : "Why it is cancelled"}
            placeholder={blocked ? "What is blocking it?" : "Why is it cancelled?"}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setReason(""); onClose(); }}>Keep as is</Button>
            <Button type="submit" variant={blocked ? "default" : "destructive"} disabled={!reason.trim()}>{blocked ? "Mark blocked" : "Cancel task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
