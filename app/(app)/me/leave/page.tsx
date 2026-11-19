import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";
import { ApplyLeaveDialog } from "@/components/leave/apply-dialog";
import { AwayCard, StateChip } from "@/components/leave/leave-bits";
import { WithdrawButton } from "@/components/leave/request-actions";
import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { availableShare, canDecideLeave, canTakeLeave, canWithdraw, daysText, rangeText, shiftDate } from "@/lib/leave";
import { isHr } from "@/lib/permissions";
import { getOfficeSettings } from "@/lib/queries/attendance";
import { getAway, getBalances, listLeaveHolidays, listLeaveTypes, listMyRequests } from "@/lib/queries/leave";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "My leave" };

export default async function MyLeavePage() {
  const me = await requireMe();
  if (!canTakeLeave(me)) {
    return (
      <Card className="max-w-xl">
        <CardHeader><CardTitle className="text-base">Leave</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground text-sm">Leave is for the team. Your role does not take leave.</CardContent>
      </Card>
    );
  }

  const today = todayIST();
  const year = Number(today.slice(0, 4));
  const supabase = await createClient();
  const [types, balances, requests, away, holidays, settings] = await Promise.all([
    listLeaveTypes(supabase),
    getBalances(supabase, me.id, year),
    listMyRequests(supabase, me.id),
    getAway(supabase, today, shiftDate(today, 45)),
    listLeaveHolidays(supabase, shiftDate(today, -30)),
    getOfficeSettings(supabase),
  ]);
  if (types.error || balances.error || requests.error) return <LoadError what="your leave" />;

  const workDays = settings.data?.work_days ?? [1, 2, 3, 4, 5];
  const kept = balances.data.filter((b) => b.has_balance);
  const hr = isHr(me);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">Your leave for {year}. Days waiting for approval are held against your balance.</p>
        <div className="flex flex-wrap gap-2">
          {canDecideLeave(me) && (
            <Link href="/hr/leave" className="hover:bg-muted focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-[3px]">
              <ClipboardCheckIcon aria-hidden className="size-4" />{hr ? "Leave admin" : "Approve leave"}
            </Link>
          )}
          <ApplyLeaveDialog
            types={types.data}
            balances={balances.data}
            workDays={workDays}
            holidays={(holidays.data ?? []).map((h) => h.holiday_date)}
            today={today}
          />
        </div>
      </div>

      <section aria-label="My balances" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kept.length === 0 && <p className="text-muted-foreground text-sm">No leave balances are set up yet.</p>}
        {kept.map((b) => (
          <Card key={b.leave_type_id} className="gap-2 px-4 py-3">
            <div className="text-muted-foreground text-xs font-medium">{b.name}</div>
            <div className="text-2xl leading-tight font-semibold tabular-nums">{daysText(b.available ?? b.balance)}</div>
            <Progress value={availableShare(b)} aria-label={`${b.name} still free`} />
            <div className="text-muted-foreground text-xs">
              {b.used > 0 ? `${daysText(b.used)} taken` : "None taken yet"}
              {b.pending > 0 ? `, ${daysText(b.pending)} waiting` : ""}
            </div>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My applications</CardTitle>
          <CardDescription>Newest first. You can withdraw leave that has not started.</CardDescription>
        </CardHeader>
        <CardContent>
          {requests.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">You have not applied for leave yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.data.map((r) => {
                  const dates = rangeText(r.from_date, r.to_date, r.day_part, String(year));
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {dates}
                        <div className="text-muted-foreground max-w-xs truncate text-xs">{r.reason}</div>
                      </TableCell>
                      <TableCell>{r.type_name}</TableCell>
                      <TableCell>{daysText(r.days)}</TableCell>
                      <TableCell>
                        <StateChip state={r.state} />
                        {r.decision_note && <div className="text-muted-foreground mt-1 max-w-xs text-xs">{r.decision_note}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWithdraw(r, today, false) && <WithdrawButton id={r.id} what={`${r.type_name} ${dates}`} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!away.error && (
        <AwayCard rows={away.data} today={today} description="The next six weeks, in your team." />
      )}
    </div>
  );
}
