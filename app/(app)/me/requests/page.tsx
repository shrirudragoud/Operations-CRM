import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { ChecklistTick } from "@/components/requests/checklist-tick";
import { RequestForm } from "@/components/requests/request-form";
import { RequestThread, StateBadge, type ThreadMessage } from "@/components/requests/request-thread";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { canHaveProfile } from "@/lib/portal";
import { listAssignedToMe, listMessages, listMyChecklist, listMyRequests } from "@/lib/queries/hr-requests";
import {
  ONBOARDING_LABELS, OWNER_LABELS, REQUEST_LABELS, type OnboardingKind, type OnboardingOwner, type RequestKind, type RequestState,
} from "@/lib/schemas/hr-requests";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Ask HR" };

export default async function MyRequestsPage() {
  const me = await requireMe();
  if (!canHaveProfile(me)) {
    return <p className="text-muted-foreground text-sm">Requests to HR are for team members. Your role doesn&apos;t have any.</p>;
  }
  const supabase = await createClient();
  const [requests, checklist, assigned] = await Promise.all([
    listMyRequests(supabase, me.id), listMyChecklist(supabase, me.id), listAssignedToMe(supabase, me.id),
  ]);
  const messages = await listMessages(supabase, (requests.data ?? []).map((r) => r.id));
  const byRequest = new Map<string, ThreadMessage[]>();
  for (const m of messages.data ?? []) {
    const list = byRequest.get(m.request_id) ?? [];
    list.push({ id: m.id, body: m.body, internal: m.internal, created_at: m.created_at, author: m.author?.full_name ?? null });
    byRequest.set(m.request_id, list);
  }

  const lists = (["joiner", "leaver"] as const).map((kind) => ({ kind, items: (checklist.data ?? []).filter((t) => t.kind === kind) })).filter((l) => l.items.length > 0);

  return (
    <div className="grid gap-6">
      {lists.map((l) => (
        <Card key={l.kind}>
          <CardHeader>
            <CardTitle>{l.kind === "joiner" ? "Your joining checklist" : "Your leaving checklist"}</CardTitle>
            <CardDescription>
              {l.items.filter((t) => t.done_at).length} of {l.items.length} done. You can tick the steps that are yours; HR and your lead tick the rest.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3" aria-label={ONBOARDING_LABELS[l.kind as OnboardingKind]}>
              {l.items.map((t) => (
                <li key={t.id} className="flex items-start gap-3">
                  <ChecklistTick id={t.id} title={t.title} done={!!t.done_at} disabled={t.owner !== "employee"} />
                  <div className="text-sm">
                    <div className={t.done_at ? "text-muted-foreground line-through" : "font-medium"}>{t.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {OWNER_LABELS[t.owner as OnboardingOwner]} · due {formatDate(t.due_on)}{t.detail ? ` · ${t.detail}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      {!!assigned.data?.length && (
        <Card>
          <CardHeader>
            <CardTitle>Checklist steps waiting on you</CardTitle>
            <CardDescription>Steps in other people&apos;s joining or leaving lists that were given to you.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3" aria-label="Steps waiting on you">
              {assigned.data.map((t) => (
                <li key={t.id} className="flex items-start gap-3">
                  <ChecklistTick id={t.id} title={`${t.title} for ${t.person?.full_name ?? "someone"}`} done={false} />
                  <div className="text-sm">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-muted-foreground text-xs">For {t.person?.full_name ?? "someone"} · due {formatDate(t.due_on)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ask HR</CardTitle>
          <CardDescription>An experience letter, an address proof, a salary certificate or a change to something HR holds. HR replies here.</CardDescription>
        </CardHeader>
        <CardContent><RequestForm /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your requests</CardTitle></CardHeader>
        <CardContent className="grid gap-6">
          {requests.error ? (
            <LoadError what="your requests" />
          ) : !requests.data?.length ? (
            <p className="text-muted-foreground text-sm">You haven&apos;t asked HR for anything yet.</p>
          ) : (
            requests.data.map((r) => (
              <section key={r.id} aria-label={r.subject} className="grid gap-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{r.subject}</h3>
                  <StateBadge state={r.state as RequestState} />
                  <span className="text-muted-foreground text-xs">{REQUEST_LABELS[r.kind as RequestKind] ?? r.kind} · {formatDate(r.created_at)}</span>
                </div>
                {r.details && <p className="text-sm whitespace-pre-wrap">{r.details}</p>}
                {r.resolution && <p className="text-sm"><span className="font-medium">HR&apos;s answer:</span> {r.resolution}</p>}
                <RequestThread requestId={r.id} subject={r.subject} state={r.state as RequestState} messages={byRequest.get(r.id) ?? []} hr={false} />
              </section>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
