"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ClockPlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeEntryDialog, type EntryDraft, type TaskOption } from "@/components/time-entry-dialog";
import { deleteTimeEntry } from "@/lib/actions/time";
import { formatHM } from "@/lib/schemas/time";

export type GridEntry = {
  id: string;
  workDate: string;
  minutes: number;
  note: string | null;
  timed: boolean;
  editable: boolean;
};
export type GridRow = { taskId: string; title: string; entries: GridEntry[] };
export type GridDay = { date: string; label: string; future: boolean; today: boolean };

const dash = (n: number) => (n ? formatHM(n) : "-");

/** Tasks down the side, the seven days across. Click a cell to see, add, edit or remove what was logged. */
export function TimesheetGrid({
  rows, days, taskOptions, today, readOnly,
}: { rows: GridRow[]; days: GridDay[]; taskOptions: TaskOption[]; today: string; readOnly: boolean }) {
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [lastDraft, setLastDraft] = useState<EntryDraft>({ taskId: "", workDate: today, length: "", note: "" });
  const [cell, setCell] = useState<{ taskId: string; date: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function openDraft(d: EntryDraft) {
    setCell(null);
    setLastDraft(d);
    setDraft(d);
  }

  const inCell = (taskId: string, date: string) => rows.find((r) => r.taskId === taskId)?.entries.filter((e) => e.workDate === date) ?? [];
  const sum = (list: GridEntry[]) => list.reduce((n, e) => n + e.minutes, 0);
  const dayTotal = (date: string) => rows.reduce((n, r) => n + sum(r.entries.filter((e) => e.workDate === date)), 0);
  const weekTotal = rows.reduce((n, r) => n + sum(r.entries), 0);

  const cellRow = cell ? rows.find((r) => r.taskId === cell.taskId) : undefined;
  const cellEntries = cell ? inCell(cell.taskId, cell.date) : [];

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteTimeEntry({ id });
      if (!res.ok) toast.error(res.error);
      else toast.success("Time removed");
    });
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div>
          <Button onClick={() => openDraft({ taskId: "", workDate: today, length: "", note: "" })}>
            <ClockPlusIcon aria-hidden /> Add time
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ClockPlusIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No time logged this week</EmptyTitle>
            <EmptyDescription>
              {readOnly ? "Nothing has been logged for this person in this week." : "Start a timer on a task, or add time by hand for work you already did."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">Task</TableHead>
                {days.map((d) => (
                  <TableHead key={d.date} className={`text-right ${d.today ? "text-foreground font-semibold" : ""}`} aria-current={d.today ? "date" : undefined}>{d.label}</TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.taskId}>
                  <TableCell className="max-w-72 truncate">
                    <Link className="underline-offset-4 hover:underline" href={`/tasks/${r.taskId}`}>{r.title}</Link>
                  </TableCell>
                  {days.map((d) => {
                    const list = inCell(r.taskId, d.date);
                    const minutes = sum(list);
                    const canAdd = !readOnly && !d.future;
                    if (list.length === 0 && !canAdd) return <TableCell key={d.date} className="text-muted-foreground text-right">-</TableCell>;
                    return (
                      <TableCell key={d.date} className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 tabular-nums"
                          aria-label={list.length ? `${formatHM(minutes)} on ${r.title}, ${d.label}. Open` : `Add time on ${r.title}, ${d.label}`}
                          onClick={() => (list.length ? setCell({ taskId: r.taskId, date: d.date }) : openDraft({ taskId: r.taskId, workDate: d.date, length: "", note: "" }))}
                        >
                          {dash(minutes)}
                        </Button>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right font-medium tabular-nums">{formatHM(sum(r.entries))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                {days.map((d) => <TableCell key={d.date} className="text-right tabular-nums">{dash(dayTotal(d.date))}</TableCell>)}
                <TableCell className="text-right font-semibold tabular-nums">{formatHM(weekTotal)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <Dialog open={cell !== null} onOpenChange={(o) => !o && setCell(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cellRow?.title ?? "Time"}</DialogTitle>
            <DialogDescription>{days.find((d) => d.date === cell?.date)?.label}</DialogDescription>
          </DialogHeader>
          <ul className="divide-y" aria-label="Entries">
            {cellEntries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{formatHM(e.minutes)}</span>
                  <span className="text-muted-foreground"> {e.timed ? "timer" : "by hand"}</span>
                  {e.note && <p className="text-muted-foreground text-xs break-words">{e.note}</p>}
                </div>
                {!readOnly && e.editable && (
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit the ${formatHM(e.minutes)} entry`}
                      onClick={() => openDraft({ id: e.id, taskId: cell?.taskId ?? "", workDate: e.workDate, length: formatHM(e.minutes), note: e.note ?? "", timed: e.timed })}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete the ${formatHM(e.minutes)} entry`} disabled={pending} onClick={() => remove(e.id)}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {cellEntries.length === 0 && <li className="text-muted-foreground py-2 text-sm">Nothing left on this day.</li>}
          </ul>
          {!readOnly && cell && (
            <div>
              <Button variant="outline" size="sm" onClick={() => openDraft({ taskId: cell.taskId, workDate: cell.date, length: "", note: "" })}>
                <ClockPlusIcon aria-hidden /> Add another entry
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TimeEntryDialog
        open={draft !== null}
        onOpenChange={(o) => !o && setDraft(null)}
        draft={draft ?? lastDraft}
        tasks={draft && !draft.id && !draft.taskId ? taskOptions : undefined}
        today={today}
      />
    </div>
  );
}
