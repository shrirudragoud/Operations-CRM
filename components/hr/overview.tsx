import type { ReactNode } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { inDaysLabel, type OverviewList, type OverviewRow } from "@/lib/hr-home";

const person = (r: OverviewRow) => (
  <Link href={`/hr/people/${r.staff_id}`} className="font-medium underline-offset-4 hover:underline">{r.full_name}</Link>
);

function Group({ title, rows, empty, render }: { title: string; rows: OverviewRow[]; empty: string; render: (r: OverviewRow) => ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-1">
      <h3 className="text-sm font-medium">{title} <span className="text-muted-foreground font-normal">({rows.length})</span></h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {rows.map((r) => <li key={`${r.list}-${r.staff_id}-${r.on_date}`}>{render(r)}</li>)}
        </ul>
      )}
    </section>
  );
}

export function Overview({ lists, today }: { lists: Record<OverviewList, OverviewRow[]>; today: string }) {
  const muted = "text-muted-foreground";
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Group title="On leave today" rows={lists.on_leave} empty="Everyone is in."
        render={(r) => <>{person(r)} <span className={muted}>· {r.detail}, until {formatDate(r.on_date)}</span></>} />
      <Group title="Joining or joined this month" rows={lists.joining} empty="No one joins this month."
        render={(r) => <>{person(r)} <span className={muted}>· {r.detail} {formatDate(r.on_date)}</span></>} />
      <Group title="Leaving" rows={lists.leaving} empty="No leaver checklist is running."
        render={(r) => <>{person(r)} <span className={muted}>· {r.detail}, last step due {formatDate(r.on_date)}</span></>} />
      <Group title="Probation ends in 30 days" rows={lists.probation} empty="No one is coming off probation."
        render={(r) => <>{person(r)} <span className={muted}>· {formatDate(r.on_date)}</span></>} />
      <Group title="New joiners with gaps" rows={lists.setup_gap} empty="Every new joiner is set up."
        render={(r) => <>{person(r)} <span className={muted}>· needs {r.detail}</span></>} />
      <Group title="Birthdays in the next 14 days" rows={lists.birthday} empty="None coming up, or no one has chosen to show theirs."
        render={(r) => <>{person(r)} <span className={muted}>· {inDaysLabel(r.on_date, today)}</span></>} />
      <Group title="Work anniversaries in the next 14 days" rows={lists.anniversary} empty="None coming up."
        render={(r) => <>{person(r)} <span className={muted}>· {r.detail} year{r.detail === "1" ? "" : "s"}, {inDaysLabel(r.on_date, today).toLowerCase()}</span></>} />
    </div>
  );
}
