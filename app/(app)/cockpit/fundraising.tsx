import Link from "next/link";
import { PlugZapIcon } from "lucide-react";
import { LoadError } from "@/components/load-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { changeText, funnelSteps, kitLoss, trend, type CockpitSegment, type KitMovement } from "@/lib/cockpit";
import { formatINR, todayIST } from "@/lib/format";
import { getFunnelSteps, getIdeFunnel, getKitMovements, getPipelineRows, getSnapshotRows } from "@/lib/queries/cockpit";
import { DEAL_KIND_LABELS, DEAL_STAGE_LABELS, OPEN_STAGES, type DealKind, type DealStage } from "@/lib/schemas/deal";
import { STAGES, STAGE_LABELS } from "@/lib/schemas/institution";
import { byStage, funnelMatrix, openTotals, wonTotals, type PipelineRow } from "@/lib/sales-reports";
import { createClient } from "@/utils/supabase/server";

const SNAPSHOT_DAYS = 35;

function daysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function Fundraising({ segment }: { segment: CockpitSegment }) {
  const supabase = await createClient();
  const today = todayIST();
  const [stepsRes, ideRes, pipelineRes, snapRes, kitRes, funnelRes] = await Promise.all([
    getFunnelSteps(supabase),
    getIdeFunnel(supabase),
    getPipelineRows(supabase),
    getSnapshotRows(supabase, daysAgo(today, SNAPSHOT_DAYS)),
    getKitMovements(supabase),
    supabase.from("v_funnel").select("segment, stage, institutions"),
  ]);
  if (stepsRes.error || ideRes.error || pipelineRes.error || snapRes.error || kitRes.error || funnelRes.error) return <LoadError what="the fundraising view" />;

  const steps = funnelSteps(stepsRes.data ?? [], segment);
  const pipeline: PipelineRow[] = (pipelineRes.data ?? []).filter((r) => segment === "all" || r.segment === segment);
  const open = openTotals(pipeline);
  const won = wonTotals(pipeline);
  const kit = kitLoss((kitRes.data ?? []) as unknown as KitMovement[]);
  const ide = ideRes.data;

  const snapshotOf = (metric: string) => (snapRes.data ?? []).filter((r) => r.metric === metric);
  const kpis = [
    { label: "Open pipeline", value: formatINR(open.value), note: `${open.deals} open deals`, t: segment === "all" ? trend(snapshotOf("pipeline_value_inr")) : null, money: true },
    { label: "Weighted pipeline", value: formatINR(open.weighted), note: "Value times win chance", t: segment === "all" ? trend(snapshotOf("pipeline_weighted_inr")) : null, money: true },
    { label: "Won", value: formatINR(won.value), note: `${won.deals} deals won`, t: segment === "all" ? trend(snapshotOf("won_value_inr")) : null, money: true },
    { label: "Kit lost or damaged", value: formatINR(kit.total), note: `${kit.units} units`, t: segment === "all" ? trend(snapshotOf("kit_loss_inr")) : null, money: true },
  ];

  const stageRows = funnelMatrix((funnelRes.data ?? []).filter((r) => segment === "all" || r.segment === segment));
  const shownStages = stageRows.filter((r) => r.total > 0);
  const stagesNow = new Map(stageRows.map((r) => [r.stage, r.total]));
  const dealStages = byStage(pipeline);
  const byKindRows = (Object.keys(DEAL_KIND_LABELS) as DealKind[])
    .map((k) => ({ kind: k, ...sumKind(pipeline, k) }))
    .filter((r) => r.open.deals + r.won.deals > 0);

  return (
    <div className="space-y-6">
      <section aria-label="Headline numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} size="sm">
            <CardHeader>
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {k.note}
              {k.t?.since ? (
                <p className="mt-1">
                  {changeText(k.t.change)} since {k.t.since}
                </p>
              ) : (
                <p className="mt-1">{segment === "all" ? "Change appears after the second nightly snapshot" : "Change is shown for all segments"}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Funnel</CardTitle>
          <CardDescription>
            Institutions that have reached each step, counting everyone who got further. The percentage is how many carried on from the step before.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 || steps[0]?.count === 0 ? (
            <p className="text-muted-foreground text-sm">No institutions have been contacted yet for this selection.</p>
          ) : (
            <ol className="space-y-2">
              {steps.map((s) => {
                const top = steps[0]?.count || 1;
                return (
                  <li key={s.step} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
                    <span>{s.label}</span>
                    <span role="img" aria-label={`${s.label}: ${s.count}`} className="bg-muted h-3 overflow-hidden rounded-full">
                      <span className="bg-primary block h-full rounded-full" style={{ width: s.count === 0 ? "0%" : `${Math.max(2, (s.count / top) * 100)}%` }} />
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{s.count}</span>
                      {s.fromPrevious !== null && <span className="text-muted-foreground ml-2 text-xs">{s.fromPrevious}%</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {ide?.connected ? (
            <div className="border-t pt-3">
              <p className="text-muted-foreground mb-2 text-xs">Students, from the IDE (all segments). Last synced {ide.last_synced ? new Date(ide.last_synced).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "never"}.</p>
              <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Signed up", ide.students_signed_up],
                  ["Compiled", ide.compiled],
                  ["Flashed a board", ide.flashed],
                  ["Published a project", ide.published],
                ].map(([label, n]) => (
                  <li key={label}>
                    <span className="block text-xl font-semibold tabular-nums">{n}</span>
                    <span className="text-muted-foreground text-xs">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Alert>
              <PlugZapIcon aria-hidden />
              <AlertTitle>Student steps are not connected</AlertTitle>
              <AlertDescription>
                Students signed up, compiled, flashed and published appear here once the IDE sync sends them. Nothing is guessed in the meantime.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where institutions are now</CardTitle>
            <CardDescription>By current stage. Open a stage to see the institutions.</CardDescription>
          </CardHeader>
          <CardContent>
            {shownStages.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing to show yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Institutions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STAGES.filter((s) => (stagesNow.get(s) ?? 0) > 0).map((s) => (
                    <TableRow key={s}>
                      <TableCell>
                        <Link className="underline-offset-4 hover:underline" href={`/institutions?stage=${s}`}>{STAGE_LABELS[s]}</Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{stagesNow.get(s)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline by deal type</CardTitle>
            <CardDescription>
              Open and won value. <Link className="underline underline-offset-4" href="/sales">Open Sales</Link> for the deals themselves, and <Link className="underline underline-offset-4" href="/sales?tab=partners">partner scorecards</Link>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {byKindRows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No deals yet for this selection.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Open value</TableHead>
                    <TableHead className="text-right">Won value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byKindRows.map((r) => (
                    <TableRow key={r.kind}>
                      <TableCell>{DEAL_KIND_LABELS[r.kind]}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.open.deals}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(r.open.value)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(r.won.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-muted-foreground mt-3 text-xs">
              {OPEN_STAGES.map((s: DealStage) => `${DEAL_STAGE_LABELS[s]} ${dealStages[s]?.deals ?? 0}`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kit lost or damaged</CardTitle>
          <CardDescription>
            Cost of kit written off, at each item&apos;s unit cost. Kit is not split by segment. <Link className="underline underline-offset-4" href="/inventory">Open Inventory</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kit.byItem.length === 0 ? (
            <p className="text-muted-foreground text-sm">No kit has been recorded as lost or damaged.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kit.byItem.slice(0, 8).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.name}{i.sku ? <span className="text-muted-foreground"> ({i.sku})</span> : null}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.units}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(i.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {kit.unpriced > 0 && (
                <p className="text-muted-foreground mt-3 text-xs">{kit.unpriced} units have no unit cost set, so they add to the units but not to the rupees.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function sumKind(rows: PipelineRow[], kind: DealKind) {
  const mine = rows.filter((r) => r.kind === kind);
  return { open: openTotals(mine), won: wonTotals(mine) };
}
