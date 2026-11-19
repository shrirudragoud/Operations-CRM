import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/portal/print-button";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireArea } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { runReport } from "@/lib/queries/reports";
import { REPORTS, canRunReport, isReportKey, parseRange, presetRanges } from "@/lib/reports";
import { createClient } from "@/utils/supabase/server";

type Props = { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: isReportKey(key) ? REPORTS[key].title : "Reports" };
}

// On paper only the report is printed: the sidebar, header and controls are hidden.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #report-print, #report-print * { visibility: visible !important; }
  #report-print { position: absolute; inset: 0; padding: 0; border: 0; }
}`;

export default async function ReportPage({ params, searchParams }: Props) {
  const { key } = await params;
  if (!isReportKey(key)) notFound();
  const meta = REPORTS[key];
  const crumbs = [{ label: "Reports", href: "/reports" }, { label: meta.title }];
  const header = <PageHeader title={meta.title} description={meta.description} crumbs={crumbs} />;

  const { me, allowed } = await requireArea("reports");
  if (!allowed || !canRunReport(me, key)) return <>{header}<AccessDenied what="this report" /></>;

  const today = todayIST();
  const range = parseRange(await searchParams, today, meta.maxDays);
  const result = await runReport(await createClient(), me, key, range, today);
  if (!result.ok) return <>{header}<LoadError what="this report" /></>;

  const query = `from=${range.from}&to=${range.to}`;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="print:hidden">{header}</div>
      <div className="grid gap-4">
        <form method="get" className="flex flex-wrap items-end gap-3 print:hidden" aria-label="Choose dates">
          <div className="grid gap-1">
            <label htmlFor="rp-from" className="text-sm font-medium">From</label>
            <Input id="rp-from" name="from" type="date" defaultValue={range.from} required className="w-44" />
          </div>
          <div className="grid gap-1">
            <label htmlFor="rp-to" className="text-sm font-medium">To</label>
            <Input id="rp-to" name="to" type="date" defaultValue={range.to} required className="w-44" />
          </div>
          <Button type="submit">Show</Button>
          <div className="flex flex-wrap gap-2 text-sm">
            {presetRanges(today).map((p) => (
              <Link key={p.label} href={`/reports/${key}?from=${p.range.from}&to=${p.range.to}`} className="text-muted-foreground hover:text-foreground underline underline-offset-4">
                {p.label}
              </Link>
            ))}
          </div>
        </form>

        <div className="flex flex-wrap gap-2 print:hidden">
          <Button asChild variant="outline">
            <a href={`/reports/${key}/export?${query}`} download>
              <DownloadIcon aria-hidden /> Download CSV
            </a>
          </Button>
          <PrintButton />
        </div>
        {range.cut && <p className="text-muted-foreground text-sm print:hidden">This report covers at most {meta.maxDays} days, so the end date was moved.</p>}

        <section id="report-print" aria-label={`${meta.title} report`} className="bg-card grid gap-3 rounded-lg border p-4">
          <header>
            <h2 className="text-lg font-semibold">{meta.title}</h2>
            <p className="text-muted-foreground text-xs">
              Hard-Code · {formatDate(range.from)} to {formatDate(range.to)} · prepared {formatDate(today)} for {me.full_name}
            </p>
          </header>
          <ReportView table={result.table} />
        </section>
      </div>
    </>
  );
}
