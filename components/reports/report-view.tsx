import { formatDate, formatINR } from "@/lib/format";
import type { Cell, CellType, ReportTable } from "@/lib/reports";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function show(value: Cell, type: CellType = "text"): string {
  if (value === null || value === "") return "";
  if (typeof value === "string" && type !== "date") return value;
  switch (type) {
    case "date":
      return formatDate(String(value));
    case "inr":
      return formatINR(value);
    case "percent":
      return `${nf.format(Number(value))}%`;
    case "number":
      return nf.format(Number(value));
    default:
      return String(value);
  }
}

const numeric = (t?: CellType): boolean => t === "inr" || t === "number" || t === "percent";

/** The table of one report, as it reads on the page and on paper. */
export function ReportView({ table }: { table: ReportTable }) {
  return (
    <div className="grid gap-3">
      {table.notes.length > 0 && (
        <ul className="text-muted-foreground list-disc pl-5 text-xs">
          {table.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {table.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing to report for these dates.</p>
      ) : (
        <Table aria-label={table.title}>
          <TableHeader>
            <TableRow>
              {table.columns.map((c) => (
                <TableHead key={c.label} className={numeric(c.type) ? "text-right" : undefined}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j} className={numeric(table.columns[j]?.type) ? "text-right tabular-nums" : undefined}>
                    {show(cell, table.columns[j]?.type)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {table.totals && (
            <TableFooter>
              <TableRow>
                {table.totals.map((cell, j) => (
                  <TableCell key={j} className={numeric(table.columns[j]?.type) ? "text-right tabular-nums" : undefined}>
                    {show(cell, table.columns[j]?.type)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      )}
    </div>
  );
}
