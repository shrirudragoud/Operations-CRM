import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/format";
import { funnelRows, openDealsForForecast, pipelineRows } from "@/lib/queries/sales";
import { DEAL_KINDS, DEAL_KIND_LABELS, DEAL_STAGES, DEAL_STAGE_LABELS } from "@/lib/schemas/deal";
import { STAGE_LABELS } from "@/lib/schemas/institution";
import { byStage, forecastByMonth, funnelMatrix, openTotals, wonTotals } from "@/lib/sales-reports";
import { createClient } from "@/utils/supabase/server";

const monthFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" });
const monthLabel = (m: string | null) => (m ? monthFmt.format(new Date(`${m}-15T00:00:00+05:30`)) : "No close date");

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-muted-foreground px-4 text-xs">{hint}</CardContent>}
    </Card>
  );
}

export async function Reports() {
  const supabase = await createClient();
  const [pipeline, funnel, forecast] = await Promise.all([pipelineRows(supabase), funnelRows(supabase), openDealsForForecast(supabase)]);
  if (pipeline.error || funnel.error || forecast.error) return <LoadError what="the reports" />;

  const open = openTotals(pipeline.data);
  const won = wonTotals(pipeline.data);
  const lost = pipeline.data.filter((r) => r.stage === "lost").reduce((n, r) => n + (r.deals ?? 0), 0);
  const decided = won.deals + lost;
  const months = forecastByMonth(forecast.data);
  const matrix = funnelMatrix(funnel.data);

  return (
    <div className="space-y-8">
      <section aria-label="Forecast summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open pipeline" value={formatINR(open.value)} hint={`${open.deals} open deals`} />
        <Stat label="Weighted forecast" value={formatINR(open.weighted)} hint="Value x chance of winning, open deals" />
        <Stat label="Won" value={formatINR(won.value)} hint={`${won.deals} deals won`} />
        <Stat label="Win rate" value={decided === 0 ? "-" : `${Math.round((won.deals / decided) * 100)}%`} hint={`${won.deals} won of ${decided} decided deals`} />
      </section>

      <section aria-labelledby="by-type" className="space-y-3">
        <h2 id="by-type" className="text-lg font-semibold">Pipeline by deal type</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal type</TableHead>
                {DEAL_STAGES.map((s) => <TableHead key={s} className="text-right">{DEAL_STAGE_LABELS[s]}</TableHead>)}
                <TableHead className="text-right">Weighted (open)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEAL_KINDS.map((k) => {
                const stages = byStage(pipeline.data, k);
                const weighted = openTotals(pipeline.data.filter((r) => r.kind === k)).weighted;
                return (
                  <TableRow key={k}>
                    <TableCell className="font-medium">{DEAL_KIND_LABELS[k]}</TableCell>
                    {DEAL_STAGES.map((s) => (
                      <TableCell key={s} className="text-right">
                        {stages[s] ? <>{stages[s].deals} <span className="text-muted-foreground">· {formatINR(stages[s].value)}</span></> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatINR(weighted)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="by-month" className="space-y-3">
        <h2 id="by-month" className="text-lg font-semibold">Forecast by expected close</h2>
        {months.length === 0 ? (
          <p className="text-muted-foreground text-sm">No open deals.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Deals</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Weighted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.month ?? "none"}>
                    <TableCell>{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-right">{m.deals}</TableCell>
                    <TableCell className="text-right">{formatINR(m.value)}</TableCell>
                    <TableCell className="text-right">{formatINR(m.weighted)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{months.reduce((s, m) => s + m.deals, 0)}</TableCell>
                  <TableCell className="text-right">{formatINR(open.value)}</TableCell>
                  <TableCell className="text-right">{formatINR(open.weighted)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="funnel" className="space-y-3">
        <h2 id="funnel" className="text-lg font-semibold">Institution funnel</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Schools</TableHead>
                <TableHead className="text-right">Colleges</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.map((r) => (
                <TableRow key={r.stage}>
                  <TableCell>{STAGE_LABELS[r.stage]}</TableCell>
                  <TableCell className="text-right">{r.school}</TableCell>
                  <TableCell className="text-right">{r.college}</TableCell>
                  <TableCell className="text-right">{r.other}</TableCell>
                  <TableCell className="text-right font-medium">{r.total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
