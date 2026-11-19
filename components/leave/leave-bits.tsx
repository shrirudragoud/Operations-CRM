import { Chip } from "@/components/chips";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { awayByPerson, rangeText, STATE_LABELS, STATE_TONE, type AwayRow, type LeaveState } from "@/lib/leave";

export function StateChip({ state }: { state: LeaveState }) {
  return <Chip tone={STATE_TONE[state]}>{STATE_LABELS[state]}</Chip>;
}

/** Who is away in the coming weeks. The database decides the names and whether the type is shown. */
export function AwayCard({ rows, today, title = "Who is away", description }: { rows: AwayRow[]; today: string; title?: string; description?: string }) {
  const people = awayByPerson(rows);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <p className="text-muted-foreground text-sm">No one is away in this time.</p>
        ) : (
          <ul className="divide-y text-sm" aria-label={title}>
            {people.map((p) => (
              <li key={p.staff_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="font-medium">{p.full_name}</span>
                <span className="text-muted-foreground">
                  {p.items.map((i) => `${rangeText(i.from_date, i.to_date, i.day_part, today.slice(0, 4))}${i.leave_type ? ` (${i.leave_type})` : ""}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
