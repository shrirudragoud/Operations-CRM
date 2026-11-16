import { LoadError } from "@/components/load-error";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/format";
import { partnerData } from "@/lib/queries/sales";
import { partnerScorecards } from "@/lib/sales-reports";
import { createClient } from "@/utils/supabase/server";

export async function PartnerScorecard() {
  const supabase = await createClient();
  const { partners, deals, institutions } = await partnerData(supabase);
  if (partners.error || deals.error || institutions.error) return <LoadError what="the partner scorecard" />;

  const cards = partnerScorecards(deals.data);
  const owned = new Map<string, number>();
  for (const i of institutions.data) if (i.owner_id) owned.set(i.owner_id, (owned.get(i.owner_id) ?? 0) + 1);

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        What each partner has brought in. Partner targets are not set yet; they will be added once the partner contract defines them.
      </p>
      {partners.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No partners yet. Invite one from Team.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Institutions</TableHead>
                <TableHead className="text-right">Open deals</TableHead>
                <TableHead className="text-right">Open value</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead className="text-right">Won value</TableHead>
                <TableHead className="text-right">Lost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.data.map((p) => {
                const c = cards.get(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.full_name}{!p.is_active && <span className="text-muted-foreground"> (inactive)</span>}
                    </TableCell>
                    <TableCell className="text-right">{owned.get(p.id) ?? 0}</TableCell>
                    <TableCell className="text-right">{c?.open ?? 0}</TableCell>
                    <TableCell className="text-right">{formatINR(c?.openValue ?? 0)}</TableCell>
                    <TableCell className="text-right">{c?.won ?? 0}</TableCell>
                    <TableCell className="text-right">{formatINR(c?.wonValue ?? 0)}</TableCell>
                    <TableCell className="text-right">{c?.lost ?? 0}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
