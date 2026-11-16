import Link from "next/link";
import { CalendarIcon, CircleAlertIcon } from "lucide-react";
import { LoadError } from "@/components/load-error";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatINR } from "@/lib/format";
import { canMarkDealWon, canMoveDeal, type Me } from "@/lib/permissions";
import { DEAL_KIND_LABELS, DEAL_STAGE_LABELS, isOverdue, weightedValue, type DealKind, type DealStage } from "@/lib/schemas/deal";
import { listBoard, type BoardDeal } from "@/lib/queries/sales";
import type { SalesParams } from "@/lib/schemas/deal";
import { createClient } from "@/utils/supabase/server";
import { DealMoveMenu } from "./deal-move";

const COLUMNS: DealStage[] = ["meeting", "proposal", "negotiation", "won", "lost"];

function DealCard({ deal, me, showKind }: { deal: BoardDeal; me: Me; showKind: boolean }) {
  const stage = deal.stage as DealStage;
  const kind = deal.kind as DealKind;
  const overdue = isOverdue(deal.expected_close, deal.stage);
  const movable = canMoveDeal(me, { stage: deal.stage, owner_id: deal.owner_id });
  return (
    <li>
      <Card className="gap-2 py-3">
        <CardContent className="space-y-2 px-3">
          <div>
            <Link href={`/sales/${deal.id}`} className="font-medium hover:underline">{deal.title}</Link>
            <div className="text-muted-foreground text-xs">
              {deal.institution.name}{deal.institution.city ? ` · ${deal.institution.city}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {showKind && <Badge variant="outline">{DEAL_KIND_LABELS[kind]}</Badge>}
            <Badge variant="secondary">{deal.institution.segment === "school" ? "School" : deal.institution.segment === "college" ? "College" : "Other"}</Badge>
            {overdue && <Badge variant="destructive"><CircleAlertIcon aria-hidden /> Overdue</Badge>}
          </div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{formatINR(deal.value_inr)}</span>
            {stage !== "won" && stage !== "lost" && deal.probability !== null && (
              <span className="text-muted-foreground text-xs">{deal.probability}% · {formatINR(weightedValue(deal.value_inr, deal.probability))}</span>
            )}
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1">
              <CalendarIcon aria-hidden className="size-3" />
              {stage === "won" ? `Won ${formatDate(deal.won_at)}` : deal.expected_close ? `Closes ${formatDate(deal.expected_close)}` : "No close date"}
            </span>
            <span>{deal.owner?.full_name ?? ""}</span>
          </div>
          {movable && (
            <DealMoveMenu
              compact
              canWon={canMarkDealWon(me)}
              deal={{ id: deal.id, title: deal.title, kind, stage, probability: deal.probability }}
            />
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export async function Board({ me, params }: { me: Me; params: SalesParams }) {
  const supabase = await createClient();
  const board = await listBoard(supabase, me, params);
  if (board.open.error || board.won.error || board.lost.error) return <LoadError what="the pipeline" />;

  const columns: Record<DealStage, { deals: BoardDeal[]; total: number }> = {
    meeting: { deals: [], total: 0 },
    proposal: { deals: [], total: 0 },
    negotiation: { deals: [], total: 0 },
    won: { deals: board.won.data, total: board.won.count ?? board.won.data.length },
    lost: { deals: board.lost.data, total: board.lost.count ?? board.lost.data.length },
  };
  for (const d of board.open.data) columns[d.stage as DealStage].deals.push(d);
  for (const stage of ["meeting", "proposal", "negotiation"] as const) columns[stage].total = columns[stage].deals.length;
  const openTotal = board.open.count ?? board.open.data.length;
  const truncated = openTotal > board.open.data.length;
  const showKind = params.kind === "";

  return (
    <div className="space-y-3">
      {truncated && (
        <p className="text-muted-foreground text-sm" role="status">
          Showing the first {board.open.data.length} of {openTotal} open deals. Narrow by deal type or segment to see the rest.
        </p>
      )}
      <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2 lg:grid-flow-row lg:grid-cols-5 lg:overflow-visible">
        {COLUMNS.map((stage) => {
          const col = columns[stage];
          const value = col.deals.reduce((s, d) => s + Number(d.value_inr ?? 0), 0);
          const closed = stage === "won" || stage === "lost";
          return (
            <section key={stage} aria-label={DEAL_STAGE_LABELS[stage]} className="bg-muted/40 min-w-0 rounded-lg border p-3">
              <header className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  {DEAL_STAGE_LABELS[stage]} <Badge variant="outline">{col.total}</Badge>
                </h2>
                {stage !== "lost" && <span className="text-muted-foreground text-xs">{formatINR(value)}</span>}
              </header>
              {col.deals.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">No deals</p>
              ) : (
                <ul className="space-y-3" aria-label={`${DEAL_STAGE_LABELS[stage]} deals`}>
                  {col.deals.map((d) => <DealCard key={d.id} deal={d} me={me} showKind={showKind} />)}
                </ul>
              )}
              {closed && col.total > col.deals.length && (
                <p className="text-muted-foreground mt-3 text-xs">Latest {col.deals.length} of {col.total}.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

