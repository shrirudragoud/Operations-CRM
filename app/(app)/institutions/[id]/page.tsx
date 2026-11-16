import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveIcon, CalendarIcon, HandshakeIcon, MessageSquareIcon } from "lucide-react";
import { z } from "zod";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { LogActivityButton } from "@/components/log-activity-dialog";
import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireArea } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import {
  canArchiveInstitution, canCorrectStage, canEditInstitution, canLogActivity, canManageContacts,
} from "@/lib/permissions";
import { getInstitution360, listOwners } from "@/lib/queries/institution";
import { KIND_LABELS as ACTIVITY_KIND_LABELS, OUTCOME_LABELS, type ActivityKind, type Outcome } from "@/lib/schemas/activity";
import { KIND_LABELS, type InstitutionKind } from "@/lib/schemas/institution";
import { createClient } from "@/utils/supabase/server";
import { ContactsPanel } from "./contacts-panel";
import { InstitutionActions } from "./institution-actions";
import { NotesPanel } from "./notes-panel";
import { OverviewPanel } from "./overview-panel";

export const metadata: Metadata = { title: "Institution" };

function ReadOnlyEmpty({
  icon, title, description, href, cta,
}: { icon: React.ReactNode; title: string; description: string; href: string; cta: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href={href}>{cta}</Link></Button>
      </EmptyContent>
    </Empty>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">{children}</li>;
}

export default async function InstitutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, allowed } = await requireArea("institutions");
  const crumbs = [{ label: "Institutions", href: "/institutions" }];
  if (!allowed) {
    return (
      <>
        <PageHeader title="Institution" crumbs={crumbs} />
        <AccessDenied what="institutions" />
      </>
    );
  }
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: inst, error } = await getInstitution360(supabase, id);
  if (error) {
    return (
      <>
        <PageHeader title="Institution" crumbs={crumbs} />
        <LoadError what="this institution" />
      </>
    );
  }
  // RLS hides institutions a partner does not own, so "not found" covers "not yours" too.
  if (!inst) notFound();

  const canEdit = canEditInstitution(me, inst.owner_id);
  const canArchive = canArchiveInstitution(me, inst.owner_id);
  const canContacts = canManageContacts(me, inst.owner_id);
  const canLog = canLogActivity(me) && inst.archived_at === null;
  const showOwner = me.role !== "partner";
  const owners = canEdit && showOwner ? ((await listOwners(supabase)).data ?? []) : [];
  const archived = inst.archived_at !== null;

  return (
    <>
      <PageHeader
        title={inst.name}
        crumbs={[...crumbs, { label: inst.name }]}
        description={[KIND_LABELS[inst.kind as InstitutionKind], [inst.city, inst.district].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
        actions={
          <InstitutionActions
            id={inst.id}
            name={inst.name}
            stage={inst.stage}
            archived={archived}
            canArchive={canArchive}
            canCorrectStage={canCorrectStage(me)}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StageBadge stage={inst.stage} />
        <span className="text-muted-foreground text-sm">
          Owner: {inst.owner?.full_name ?? "Unassigned"}
        </span>
      </div>

      {archived && (
        <Alert className="mb-4">
          <ArchiveIcon aria-hidden />
          <AlertTitle>This institution is archived</AlertTitle>
          <AlertDescription>
            Archived on {formatDate(inst.archived_at)}
            {inst.archiver?.full_name ? ` by ${inst.archiver.full_name}` : ""}. It is hidden from the main list.
            {canArchive ? " Use Restore to bring it back." : " A founder or department lead can restore it."}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({inst.contacts.length})</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="deals">Deals</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <Card>
            <CardContent>
              <OverviewPanel
                institution={{
                  id: inst.id,
                  name: inst.name,
                  kind: inst.kind as InstitutionKind,
                  affiliation: inst.affiliation,
                  city: inst.city,
                  district: inst.district,
                  state: inst.state,
                  source: inst.source,
                  notes: inst.notes,
                  owner_id: inst.owner_id,
                  created_at: inst.created_at,
                  updated_at: inst.updated_at,
                  owner_name: inst.owner?.full_name ?? null,
                }}
                owners={owners}
                canEdit={canEdit}
                showOwner={showOwner}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="pt-4">
          <ContactsPanel
            institutionId={inst.id}
            canManage={canContacts}
            contacts={inst.contacts.map((c) => ({
              id: c.id,
              full_name: c.full_name,
              designation: c.designation,
              influence: c.influence as "decision_maker" | "influencer" | "user" | "other" | null,
              phone: c.phone,
              email: c.email,
            }))}
          />
        </TabsContent>

        <TabsContent value="activities" className="pt-4">
          {canLog && (
            <div className="mb-4">
              <LogActivityButton
                institution={{ id: inst.id, name: inst.name }}
                contacts={inst.contacts.map((c) => ({ id: c.id, full_name: c.full_name }))}
              />
            </div>
          )}
          {inst.activities.length === 0 ? (
            <ReadOnlyEmpty
              icon={<MessageSquareIcon aria-hidden />}
              title="No activities yet"
              description="Calls, visits and emails logged in Outreach show up here."
              href="/outreach"
              cta="Go to Outreach"
            />
          ) : (
            <ul className="divide-y rounded-lg border px-4" aria-label="Recent activities">
              {inst.activities.map((a) => (
                <Row key={a.id}>
                  <div>
                    <div className="font-medium">
                      {ACTIVITY_KIND_LABELS[a.kind as ActivityKind] ?? a.kind}
                      {a.outcome ? <span className="text-muted-foreground font-normal"> · {OUTCOME_LABELS[a.outcome as Outcome] ?? a.outcome}</span> : null}
                    </div>
                    {a.notes && <div className="text-muted-foreground line-clamp-2 text-sm">{a.notes}</div>}
                    {a.next_step && (
                      <div className="text-sm">Next: {a.next_step}{a.next_step_due ? ` (by ${formatDate(a.next_step_due)})` : ""}</div>
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDateTime(a.happened_at)}{a.author?.full_name ? ` · ${a.author.full_name}` : ""}
                  </div>
                </Row>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="deals" className="pt-4">
          {inst.deals.length === 0 ? (
            <ReadOnlyEmpty
              icon={<HandshakeIcon aria-hidden />}
              title="No deals yet"
              description="Deals are created and moved in Sales. They will show up here."
              href="/sales"
              cta="Go to Sales"
            />
          ) : (
            <ul className="divide-y rounded-lg border px-4" aria-label="Deals">
              {inst.deals.map((d) => (
                <Row key={d.id}>
                  <div className="font-medium">
                    {d.title} {d.archived_at && <Badge variant="outline">Archived</Badge>}
                    <div className="text-muted-foreground text-sm font-normal">{d.kind}</div>
                  </div>
                  <div className="text-sm">
                    <Badge variant="secondary">{d.stage}</Badge> {formatINR(d.value_inr)}
                    {d.expected_close ? ` · closes ${formatDate(d.expected_close)}` : ""}
                  </div>
                </Row>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="events" className="pt-4">
          {inst.events.length === 0 ? (
            <ReadOnlyEmpty
              icon={<CalendarIcon aria-hidden />}
              title="No events yet"
              description="Workshops and demos are scheduled in Workshop. They will show up here."
              href="/workshop"
              cta="Go to Workshop"
            />
          ) : (
            <ul className="divide-y rounded-lg border px-4" aria-label="Events">
              {inst.events.map((ev) => (
                <Row key={ev.id}>
                  <div className="font-medium">
                    {ev.title} {ev.archived_at && <Badge variant="outline">Archived</Badge>}
                    <div className="text-muted-foreground text-sm font-normal">{ev.kind}</div>
                  </div>
                  <div className="text-sm">
                    <Badge variant="secondary">{ev.status}</Badge> {ev.starts_at ? formatDateTime(ev.starts_at) : "Date not set"}
                  </div>
                </Row>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="notes" className="pt-4">
          <NotesPanel id={inst.id} notes={inst.notes} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </>
  );
}
