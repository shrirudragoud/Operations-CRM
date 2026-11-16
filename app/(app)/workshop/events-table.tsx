import Link from "next/link";
import { CalendarIcon } from "lucide-react";
import { EventStatusBadge } from "@/components/event-status-badge";
import { LoadError } from "@/components/load-error";
import { Pager } from "@/components/pager";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRange } from "@/lib/format";
import type { Me } from "@/lib/permissions";
import { listEvents } from "@/lib/queries/workshop";
import { EVENT_KIND_LABELS, WORKSHOP_PAGE_SIZE, type EventKind, type WorkshopParams } from "@/lib/schemas/event";
import { createClient } from "@/utils/supabase/server";

export async function EventsTable({
  me, params, link,
}: { me: Me; params: WorkshopParams; link: (p: Partial<WorkshopParams>) => string }) {
  const supabase = await createClient();
  const { data, count, error } = await listEvents(supabase, me, params);
  if (error) return <LoadError what="the events" />;

  const total = count ?? data.length;
  const pages = Math.max(1, Math.ceil(total / WORKSHOP_PAGE_SIZE));
  if (data.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CalendarIcon aria-hidden /></EmptyMedia>
          <EmptyTitle>No events match</EmptyTitle>
          <EmptyDescription>Winning a workshop or FDP deal creates one here, or add one with New event.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Lead trainer</TableHead>
              <TableHead className="text-right">Students</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell>
                  <Link href={`/workshop/${ev.id}`} className="font-medium hover:underline">{ev.title}</Link>
                  <div className="text-muted-foreground text-xs">
                    {ev.institution.name}{ev.institution.city ? ` · ${ev.institution.city}` : ""}
                  </div>
                </TableCell>
                <TableCell>{EVENT_KIND_LABELS[ev.kind as EventKind] ?? ev.kind}</TableCell>
                <TableCell><EventStatusBadge status={ev.status} /></TableCell>
                <TableCell className="text-sm">{formatRange(ev.starts_at, ev.ends_at)}</TableCell>
                <TableCell>{ev.lead?.full_name ?? <span className="text-muted-foreground">Not assigned</span>}</TableCell>
                <TableCell className="text-right">{ev.expected_headcount ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager page={params.page} pages={pages} total={total} noun={["event", "events"]} href={(page) => link({ page })} />
    </div>
  );
}
