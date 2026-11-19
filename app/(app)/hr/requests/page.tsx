import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { RequestThread, StateBadge, type ThreadMessage } from "@/components/requests/request-thread";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { listAllRequests, listMessages } from "@/lib/queries/hr-requests";
import { REQUEST_LABELS, type RequestKind, type RequestState } from "@/lib/schemas/hr-requests";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "HR requests" };

const crumbs = [{ label: "People & HR", href: "/hr" }, { label: "Requests" }];

export default async function HrRequestsPage() {
  const { allowed } = await requireArea("hr");
  const header = <PageHeader title="Requests" description="What people have asked HR for." crumbs={crumbs} />;
  if (!allowed) return <>{header}<AccessDenied what="People & HR" /></>;

  const supabase = await createClient();
  const requests = await listAllRequests(supabase);
  if (requests.error) return <>{header}<LoadError what="the requests" /></>;
  const rows = requests.data ?? [];
  const messages = await listMessages(supabase, rows.map((r) => r.id));
  const byRequest = new Map<string, ThreadMessage[]>();
  for (const m of messages.data ?? []) {
    const list = byRequest.get(m.request_id) ?? [];
    list.push({ id: m.id, body: m.body, internal: m.internal, created_at: m.created_at, author: m.author?.full_name ?? null });
    byRequest.set(m.request_id, list);
  }

  const waiting = rows.filter((r) => r.state === "open" || r.state === "in_progress").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const closed = rows.filter((r) => r.state === "done" || r.state === "rejected");

  const card = (r: (typeof rows)[number]) => (
    <section key={r.id} aria-label={`${r.owner?.full_name ?? "Someone"}: ${r.subject}`} className="grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{r.subject}</h3>
        <StateBadge state={r.state as RequestState} />
        <span className="text-muted-foreground text-xs">
          {r.owner?.full_name ?? "Someone"} · {REQUEST_LABELS[r.kind as RequestKind] ?? r.kind} · {formatDate(r.created_at)}
        </span>
      </div>
      {r.details && <p className="text-sm whitespace-pre-wrap">{r.details}</p>}
      {r.resolution && <p className="text-sm"><span className="font-medium">Answer:</span> {r.resolution}</p>}
      <RequestThread requestId={r.id} subject={r.subject} state={r.state as RequestState} messages={byRequest.get(r.id) ?? []} hr />
    </section>
  );

  return (
    <>
      {header}
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Waiting for an answer</CardTitle>
            <CardDescription>Oldest first. Internal notes are never shown to the person.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {waiting.length === 0 ? <p className="text-muted-foreground text-sm">Nothing is waiting.</p> : waiting.map(card)}
          </CardContent>
        </Card>
        {closed.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Closed</CardTitle></CardHeader>
            <CardContent className="grid gap-4">{closed.map(card)}</CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
