import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { ACTION_HREFS, ACTION_LABELS, actionDetail, isActionKind, waitLabel, type ActionRow } from "@/lib/hr-home";

const VERBS: Record<string, string> = { leave: "Review", request: "Answer", document: "Verify", expiring: "Check", onboarding: "Open" };
const SHOWN = 12;

const link = "text-primary text-sm font-medium underline-offset-4 hover:underline";

function Row({ row, today }: { row: ActionRow; today: string }) {
  if (!isActionKind(row.kind)) return null;
  const wait = waitLabel(row, today);
  const extra = row.kind === "leave" && row.due_on ? ` · starts ${formatDate(row.due_on)}` : "";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <Badge variant={row.urgent ? "destructive" : "secondary"} className="w-32 shrink-0">{ACTION_LABELS[row.kind]}</Badge>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <Link href={`/hr/people/${row.staff_id}`} className="font-medium underline-offset-4 hover:underline">{row.full_name}</Link>
          <span className="text-muted-foreground"> · {row.title}</span>
        </div>
        <div className="text-muted-foreground text-xs">{actionDetail(row)}{extra} · {wait}</div>
      </div>
      <Link href={ACTION_HREFS[row.kind]} className={link} aria-label={`${VERBS[row.kind]}: ${row.title} for ${row.full_name}`}>
        {VERBS[row.kind]}
      </Link>
    </li>
  );
}

export function ActionList({ rows, today }: { rows: ActionRow[]; today: string }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing is waiting on HR. New leave requests, questions, papers and checklist steps will show up here.</p>;
  }
  const first = rows.slice(0, SHOWN);
  const rest = rows.slice(SHOWN);
  return (
    <div>
      <ul aria-label="Needs action" className="divide-y">
        {first.map((r) => <Row key={`${r.kind}-${r.ref_id}`} row={r} today={today} />)}
      </ul>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="text-primary cursor-pointer py-2 text-sm font-medium">Show {rest.length} more</summary>
          <ul aria-label="More that needs action" className="divide-y">
            {rest.map((r) => <Row key={`${r.kind}-${r.ref_id}`} row={r} today={today} />)}
          </ul>
        </details>
      )}
    </div>
  );
}
