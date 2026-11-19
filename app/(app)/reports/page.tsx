import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { REPORTS, reportsFor } from "@/lib/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { me, allowed } = await requireArea("reports");
  const header = <PageHeader title="Reports" description="Tables you can read here, print, or download for a spreadsheet." crumbs={[{ label: "Reports" }]} />;
  if (!allowed) return <>{header}<AccessDenied what="Reports" /></>;

  const keys = reportsFor(me);
  return (
    <>
      {header}
      {keys.length === 0 ? (
        <p className="text-muted-foreground text-sm">No reports are open to you yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Reports">
          {keys.map((k) => (
            <li key={k}>
              <Link href={`/reports/${k}`} className="focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]">
                <Card className="hover:bg-muted/40 h-full transition-colors">
                  <CardHeader>
                    <CardTitle>{REPORTS[k].title}</CardTitle>
                    <CardDescription>{REPORTS[k].description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
