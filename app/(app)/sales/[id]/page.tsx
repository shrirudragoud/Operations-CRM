import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveIcon } from "lucide-react";
import { z } from "zod";
import { AccessDenied } from "@/components/access-denied";
import { DealStageBadge } from "@/components/deal-stage-badge";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import {
  canAccess, canArchiveDeal, canEditDeal, canMarkDealWon, canMoveDeal, canWrite,
} from "@/lib/permissions";
import { listOwners } from "@/lib/queries/institution";
import { getDeal } from "@/lib/queries/sales";
import {
  DEAL_KIND_LABELS, isOverdue, linesTotal, lineTotal, wonOutcome, type DealKind, type DealStage,
} from "@/lib/schemas/deal";
import { createClient } from "@/utils/supabase/server";
import { DealArchiveButton } from "./deal-actions";
import { DealDetailsForm } from "./deal-details-form";
import { LinesEditor } from "./lines-editor";
import { DealMoveMenu } from "../deal-move";

export const metadata: Metadata = { title: "Deal" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, allowed } = await requireArea("sales");
  const crumbs = [{ label: "Sales", href: "/sales" }];
  if (!allowed) {
    return (
      <>
        <PageHeader title="Deal" crumbs={crumbs} />
        <AccessDenied what="Sales" />
      </>
    );
  }
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: deal, error } = await getDeal(supabase, id);
  if (error) {
    return (
      <>
        <PageHeader title="Deal" crumbs={crumbs} />
        <LoadError what="this deal" />
      </>
    );
  }
  // RLS hides deals a partner does not own, so "not found" covers "not yours" too.
  if (!deal) notFound();

  const stage = deal.stage as DealStage;
  const kind = deal.kind as DealKind;
  const archived = deal.archived_at !== null;
  const ref = { stage: deal.stage, owner_id: deal.owner_id };
  const editable = !archived && canEditDeal(me, ref);
  const movable = !archived && canMoveDeal(me, ref);
  const showOwnerPicker = editable && me.role !== "partner";
  const owners = showOwnerPicker ? ((await listOwners(supabase)).data ?? []) : null;
  const savedTotal = linesTotal(deal.lines);
  const overdue = isOverdue(deal.expected_close, deal.stage);

  const details = {
    id: deal.id,
    title: deal.title,
    value_inr: String(Number(deal.value_inr)),
    probability: deal.probability === null ? "" : String(deal.probability),
    expected_close: deal.expected_close ?? "",
    owner_id: deal.owner_id,
  };

  return (
    <>
      <PageHeader
        title={deal.title}
        crumbs={[...crumbs, { label: deal.title }]}
        description={`${DEAL_KIND_LABELS[kind]} · ${deal.institution.name}`}
        actions={
          <>
            {movable && (
              <DealMoveMenu
                canWon={canMarkDealWon(me)}
                deal={{ id: deal.id, title: deal.title, kind, stage, probability: deal.probability }}
              />
            )}
            {canArchiveDeal(me) && (stage === "won" || stage === "lost") && (
              <DealArchiveButton id={deal.id} title={deal.title} archived={archived} />
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DealStageBadge stage={deal.stage} />
        <span className="text-lg font-semibold">{formatINR(deal.value_inr)}</span>
        {overdue && <Badge variant="destructive">Past expected close</Badge>}
        <span className="text-muted-foreground text-sm">Owner: {deal.owner?.full_name ?? "Unassigned"}</span>
      </div>

      {archived && (
        <Alert className="mb-4">
          <ArchiveIcon aria-hidden />
          <AlertTitle>This deal is archived</AlertTitle>
          <AlertDescription>
            Archived on {formatDate(deal.archived_at)}{deal.archiver?.full_name ? ` by ${deal.archiver.full_name}` : ""}. It is hidden from the board.
            {canArchiveDeal(me) ? " Use Restore to bring it back." : ""}
          </AlertDescription>
        </Alert>
      )}

      {stage === "lost" && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Lost</AlertTitle>
          <AlertDescription>{deal.lost_reason}{movable ? " Move it back to Meeting to reopen it." : ""}</AlertDescription>
        </Alert>
      )}

      {stage === "won" && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Won {formatDate(deal.won_at)}</CardTitle>
            <CardDescription>Winning created:</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm">
              {wonOutcome(kind).map((t) => <li key={t}>{t}</li>)}
            </ul>
            {deal.events.length > 0 && (
              <p className="mt-3 text-sm">
                Event:{" "}
                {deal.events.map((ev, i) => (
                  <span key={ev.id}>
                    {i > 0 && ", "}
                    {canAccess(me, "workshop") ? <Link className="underline" href={`/workshop/${ev.id}`}>{ev.title}</Link> : ev.title}
                    {" "}<Badge variant="secondary">{ev.status}</Badge>
                  </span>
                ))}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              {editable ? (
                <DealDetailsForm initial={details} owners={owners} />
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Fact label="Value">{formatINR(deal.value_inr)}</Fact>
                  <Fact label="Chance of winning">{deal.probability === null ? "-" : `${deal.probability}%`}</Fact>
                  <Fact label="Expected close">{formatDate(deal.expected_close)}</Fact>
                  <Fact label="Owner">{deal.owner?.full_name ?? "Unassigned"}</Fact>
                  {!canWrite(me) ? null : stage === "won" && me.role !== "founder" ? (
                    <Fact label="Editing">A won deal can only be corrected by the founder.</Fact>
                  ) : null}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Proposal lines</CardTitle>
              <CardDescription>What the deal includes. The deal value above is set separately.</CardDescription>
            </CardHeader>
            <CardContent>
              {editable ? (
                <LinesEditor
                  key={deal.updated_at}
                  dealId={deal.id}
                  initial={deal.lines.map((l) => ({ description: l.description, qty: String(Number(l.qty)), unit_price_inr: String(Number(l.unit_price_inr)) }))}
                  savedTotal={savedTotal}
                  details={details}
                  dealValue={Number(deal.value_inr)}
                />
              ) : deal.lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">No lines.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deal.lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{l.description}</TableCell>
                          <TableCell className="text-right">{Number(l.qty)}</TableCell>
                          <TableCell className="text-right">{formatINR(l.unit_price_inr)}</TableCell>
                          <TableCell className="text-right">{formatINR(lineTotal(l))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3}>Total</TableCell>
                        <TableCell className="text-right">{formatINR(savedTotal)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Institution</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Fact label="Name"><Link className="underline" href={`/institutions/${deal.institution.id}`}>{deal.institution.name}</Link></Fact>
                <Fact label="Segment">{deal.institution.segment === "school" ? "School" : deal.institution.segment === "college" ? "College" : "Other"}</Fact>
                <Fact label="Location">{[deal.institution.city, deal.institution.district].filter(Boolean).join(", ") || "-"}</Fact>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Fact label="Opened">{formatDateTime(deal.created_at)}</Fact>
                <Fact label="Last changed">{formatDateTime(deal.updated_at)}</Fact>
                {deal.won_at && <Fact label="Won">{formatDateTime(deal.won_at)}</Fact>}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
