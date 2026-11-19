import Link from "next/link";
import {
  CircleAlertIcon, ClipboardCheckIcon, HandshakeIcon, HourglassIcon, MapPinIcon, MegaphoneIcon, PhoneIcon, PresentationIcon, RepeatIcon,
} from "lucide-react";
import { cn } from "cn";
import { Chip } from "@/components/chips";
import { formatDate } from "@/lib/format";
import {
  AGENDA_DAYS, CAL_GROUPS, CAL_GROUP_LABELS, dayPosition, formatTime, formatTimeRange, itemsByDay, layoutBanners, rangeTitle, viewRange, weekDays,
  type CalGroup, type CalItem, type CalView,
} from "@/lib/schemas/calendar";
import { MEETING_KIND_TONE, TONE_CHIP, TONE_PANEL, TONE_STRIPE, TONE_TEXT, type Tone } from "@/lib/tone";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

const SOURCE_TONE: Record<CalItem["source"], Tone> = { event: "orange", meeting: "slate", task: "slate", activity: "violet", deal: "blue", content: "green" };

const overdue = (item: CalItem, day: string, today: string) => item.source === "task" && !item.done && day < today;

export function itemTone(item: CalItem, day?: string, today?: string): Tone {
  if (item.source === "meeting") return MEETING_KIND_TONE[item.kind] ?? "slate";
  if (day && today && overdue(item, day, today)) return "red";
  if (item.source === "task" && item.health && (item.reminder || item.health.level > 0)) return item.health.tone;
  return SOURCE_TONE[item.source];
}

/** A task that is close, at risk or late is filled with its health colour; a calm one stays an outline. */
const loud = (item: CalItem, tone: Tone) => item.source === "meeting" || (item.source === "task" && tone !== "slate");

function ItemIcon({ item, className }: { item: CalItem; className?: string }) {
  switch (item.source) {
    case "event": return <PresentationIcon aria-hidden className={className} />;
    case "task": return <ClipboardCheckIcon aria-hidden className={className} />;
    case "activity": return item.kind === "call" || item.kind === "whatsapp" ? <PhoneIcon aria-hidden className={className} /> : <MapPinIcon aria-hidden className={className} />;
    case "deal": return <HandshakeIcon aria-hidden className={className} />;
    case "content": return <MegaphoneIcon aria-hidden className={className} />;
    default: return null;
  }
}

function timeText(item: CalItem, day?: string): string | null {
  if (item.when) return item.when;
  const pos = day && !item.allDay ? dayPosition(item, day) : null;
  if (pos) return pos.n === 1 ? `From ${formatTime(item.starts_at)}` : pos.n === pos.of ? `Until ${formatTime(item.ends_at)}` : "All day";
  return item.allDay ? "All day" : formatTimeRange(item.starts_at, item.ends_at);
}

function statusText(item: CalItem): string | null {
  if (item.pending) return "waiting for an answer";
  if (item.source === "event") return null;
  if (item.source === "meeting") return item.status === "scheduled" ? null : item.status;
  return item.status.replaceAll("_", " ");
}

function label(item: CalItem, day?: string, today?: string): string {
  const pos = day ? dayPosition(item, day) : null;
  const parts = [
    item.title,
    timeText(item, day),
    item.kindLabel,
    pos ? `day ${pos.n} of ${pos.of}` : null,
    item.institution,
    item.role,
    statusText(item),
    day && today && overdue(item, day, today) ? "overdue" : null,
    item.health && !item.done ? item.health.detail : null,
    item.reminder ? "reminder, the deadline is coming" : null,
    item.done && item.source === "task" ? "done" : null,
    item.needsMe ? "needs your answer" : null,
    item.place,
  ];
  return parts.filter(Boolean).join(", ");
}

/** A small chip: a meeting is filled with its kind's colour and starts with its time; other work has an outline and an icon. */
function ItemChip({ item, day, today, clash }: { item: CalItem; day: string; today: string; clash: boolean }) {
  const tone = itemTone(item, day, today);
  const timed = !item.allDay;
  return (
    <Link
      href={item.href}
      aria-label={label(item, day, today)}
      title={label(item, day, today)}
      className={cn(
        "flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-xs hover:underline",
        loud(item, tone) || tone === "red" ? TONE_CHIP[tone] : "bg-card",
        (item.pending || item.reminder) && "border-dashed",
        item.needsMe && "ring-primary ring-1",
        item.done && "opacity-60",
      )}
    >
      {item.pending && <HourglassIcon aria-hidden className="size-3 shrink-0" />}
      {item.recurring && <RepeatIcon aria-hidden className="size-3 shrink-0" />}
      {clash && <CircleAlertIcon aria-hidden className="size-3 shrink-0" />}
      <ItemIcon item={item} className={cn("size-3 shrink-0", TONE_TEXT[tone])} />
      {timed && <span className="shrink-0 tabular-nums">{formatTime(item.starts_at)}</span>}
      <span className={cn("truncate", item.done && "line-through")}>{item.title}</span>
    </Link>
  );
}

type ViewProps = {
  items: CalItem[];
  date: string;
  today: string;
  clashes: Set<string>;
  /** Link to a day (the week starting there). */
  dayHref: (day: string) => string;
};

/** Workshop events as bars across one week, one lane per overlapping run, so a multi-day workshop reads as one block. */
function WorkshopBanners({ workshops, week, today, clashes }: { workshops: CalItem[]; week: string[]; today: string; clashes: Set<string> }) {
  const lanes = layoutBanners(workshops, week);
  return (
    <>
      {lanes.map((lane, i) => (
        <div key={i} className="relative grid grid-cols-7 gap-y-0.5 py-0.5">
          {lane.map((b) => {
            const day = week[b.col]!;
            const pos = dayPosition(b.item, day);
            const single = !pos;
            return (
              <Link
                key={b.item.key}
                href={b.item.href}
                style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: 1 }}
                aria-label={label(b.item, day, today)}
                title={label(b.item, day, today)}
                className={cn(
                  "mx-0.5 flex h-6 items-center gap-1 truncate border px-1.5 text-xs font-medium hover:underline",
                  TONE_CHIP.orange,
                  b.continuesBefore ? "ml-0 rounded-l-none border-l-0" : "rounded-l",
                  b.continuesAfter ? "mr-0 rounded-r-none border-r-0" : "rounded-r",
                  b.item.done && "opacity-60",
                )}
              >
                <PresentationIcon aria-hidden className="size-3 shrink-0" />
                {clashes.has(b.item.key) && <CircleAlertIcon aria-hidden className="size-3 shrink-0" />}
                {single && <span className="shrink-0 tabular-nums">{formatTime(b.item.starts_at)}</span>}
                <span className="truncate">{b.item.title}</span>
                {b.item.institution && <span className="truncate font-normal opacity-80">· {b.item.institution}</span>}
                {pos && <span className="shrink-0 font-normal opacity-80">· Day {pos.n} of {pos.of}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function CalendarMonth({ items, date, today, clashes, dayHref }: ViewProps) {
  const month = date.slice(0, 7);
  const workshops = items.filter((i) => i.group === "workshop");
  const byDay = itemsByDay(items.filter((i) => i.group !== "workshop"));
  const { days } = viewRange("month", date);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem] overflow-hidden rounded-lg border" role="group" aria-label={`Calendar for ${rangeTitle("month", date)}`}>
        <div className="bg-muted/50 grid grid-cols-7 border-b text-xs font-medium" aria-hidden>
          {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="relative border-b last:border-b-0">
            <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-7">
              {week.map((day) => <div key={day} className={cn("border-r last:border-r-0", !day.startsWith(month) && "bg-muted/30")} />)}
            </div>
            <div className="relative">
              <div className="grid grid-cols-7">
                {week.map((day) => (
                  <div key={day} className="px-1.5 pt-1.5">
                    <Link
                      href={dayHref(day)}
                      aria-label={`${formatDate(day)}${day === today ? ", today" : ""}`}
                      className={cn(
                        "text-xs hover:underline",
                        !day.startsWith(month) && "text-muted-foreground",
                        day === today && "bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full font-semibold",
                      )}
                    >
                      {Number(day.slice(8))}
                    </Link>
                  </div>
                ))}
              </div>
              <WorkshopBanners workshops={workshops} week={week} today={today} clashes={clashes} />
              <div className="grid min-h-16 grid-cols-7">
                {week.map((day) => {
                  const list = byDay.get(day) ?? [];
                  const shown = list.slice(0, MAX_PER_DAY);
                  const hidden = list.length - shown.length;
                  return (
                    <div key={day} className={cn("min-w-0 space-y-1 p-1.5", !day.startsWith(month) && "text-muted-foreground")}>
                      {shown.map((it) => <ItemChip key={`${day}${it.key}`} item={it} day={day} today={today} clash={clashes.has(it.key)} />)}
                      {hidden > 0 && <Link href={dayHref(day)} className="text-muted-foreground block text-xs underline">+{hidden} more</Link>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const WEEK_GROUP_LABEL: Record<CalGroup, string> = { workshop: "Workshops", meeting: "Meetings", task: "Due", other: "Outreach, sales, content" };

export function CalendarWeek({ items, date, today, clashes, dayHref }: ViewProps) {
  const week = weekDays(date);
  const workshops = items.filter((i) => i.group === "workshop");
  const byDay = itemsByDay(items.filter((i) => i.group !== "workshop"));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[56rem] space-y-2" role="group" aria-label={`Week of ${rangeTitle("week", date)}`}>
        {workshops.length > 0 && (
          <div className="bg-card rounded-lg border px-1 py-1" aria-label="Workshops this week" role="group">
            <WorkshopBanners workshops={workshops} week={week} today={today} clashes={clashes} />
          </div>
        )}
        <div className="grid grid-cols-7 gap-2" role="list">
          {week.map((day, i) => {
            const list = byDay.get(day) ?? [];
            const groups = CAL_GROUPS.filter((g) => list.some((it) => it.group === g));
            return (
              <section key={day} role="listitem" aria-label={formatDate(day)} className={cn("bg-card min-h-48 space-y-2 rounded-lg border p-2", day === today && "ring-primary ring-2")}>
                <Link href={dayHref(day)} className="block text-xs font-medium hover:underline">
                  {WEEKDAYS[i]} <span className="text-muted-foreground">{Number(day.slice(8))}</span>
                </Link>
                {list.length === 0 && <p className="text-muted-foreground text-xs">Free</p>}
                {groups.map((g) => (
                  <div key={g} className="space-y-1">
                    <h4 className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">{WEEK_GROUP_LABEL[g]}</h4>
                    {list.filter((it) => it.group === g).map((it) => {
                      const tone = itemTone(it, day, today);
                      return (
                        <Link
                          key={it.key}
                          href={it.href}
                          aria-label={label(it, day, today)}
                          className={cn(
                            "block space-y-0.5 rounded-md border border-l-4 p-1.5 text-xs hover:underline",
                            TONE_STRIPE[tone],
                            (it.pending || it.reminder) && "border-dashed",
                            it.health && it.health.level >= 2 && !it.done && TONE_PANEL[tone],
                            it.needsMe && "ring-primary ring-1",
                            it.done && "opacity-60",
                          )}
                        >
                          <span className={cn("flex items-center gap-1 font-medium", it.done && "line-through")}>
                            {it.pending && <HourglassIcon aria-hidden className="size-3" />}
                            {it.recurring && <RepeatIcon aria-hidden className="size-3" />}
                            {clashes.has(it.key) && <CircleAlertIcon aria-hidden className="size-3" />}
                            {it.title}
                          </span>
                          <span className="text-muted-foreground block tabular-nums">{timeText(it, day)}</span>
                          {it.health && !it.done && it.health.level > 0 && <span className={cn("block font-medium", TONE_TEXT[tone])}>{it.health.label}</span>}
                          {(it.institution || it.place) && <span className="text-muted-foreground block truncate">{it.institution ?? it.place}</span>}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarAgenda({ items, date, today, clashes }: Omit<ViewProps, "dayHref">) {
  const byDay = itemsByDay(items);
  const days = viewRange("agenda", date).days.filter((d) => byDay.has(d));
  if (days.length === 0) {
    return <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">Nothing on the calendar for the next {AGENDA_DAYS} days.</p>;
  }
  return (
    <ol className="space-y-4" aria-label="Agenda">
      {days.map((day) => {
        const list = byDay.get(day) ?? [];
        return (
          <li key={day}>
            <h3 className={cn("mb-1.5 text-sm font-semibold", day === today && "text-primary")}>{formatDate(day)}{day === today && " · Today"}</h3>
            <div className="space-y-2">
              {CAL_GROUPS.filter((g) => list.some((it) => it.group === g)).map((g) => (
                <div key={g}>
                  <h4 className="text-muted-foreground mb-0.5 text-[11px] font-semibold tracking-wide uppercase">{CAL_GROUP_LABELS[g]}</h4>
                  <ul className="divide-y rounded-lg border">
                    {list.filter((it) => it.group === g).map((it) => {
                      const tone = itemTone(it, day, today);
                      const pos = dayPosition(it, day);
                      return (
                        <li key={it.key}>
                          <Link href={it.href} className={cn("hover:bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-4 px-3 py-2 text-sm", TONE_STRIPE[tone], it.done && "opacity-60")}>
                            <span className="text-muted-foreground w-36 shrink-0 tabular-nums">{timeText(it, day)}</span>
                            <ItemIcon item={it} className={cn("size-4 shrink-0", TONE_TEXT[tone])} />
                            <span className={cn("font-medium", it.done && "line-through")}>{it.title}</span>
                            {it.health && !it.done ? <Chip tone={tone} title={it.health.detail}>{it.health.label}</Chip> : <Chip tone={tone}>{it.kindLabel}</Chip>}
                            {pos && <Chip tone="orange">Day {pos.n} of {pos.of}</Chip>}
                            {it.role && <Chip tone="slate">{it.role}</Chip>}
                            {overdue(it, day, today) && !it.health && <Chip tone="red">Overdue</Chip>}
                            {it.reminder && <Chip tone="slate">Reminder</Chip>}
                            {it.pending && <Chip tone="amber" icon={HourglassIcon}>Requested</Chip>}
                            {it.needsMe && <Chip tone="violet">Needs your answer</Chip>}
                            {it.recurring && <Chip tone="slate" icon={RepeatIcon}>Fixed</Chip>}
                            {clashes.has(it.key) && <Chip tone="red" icon={CircleAlertIcon}>Clashes</Chip>}
                            {it.institution && <span className="text-muted-foreground">{it.institution}</span>}
                            {it.place && <span className="text-muted-foreground">{it.place}</span>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CalendarBody({ view, ...props }: ViewProps & { view: CalView }) {
  if (view === "week") return <CalendarWeek {...props} />;
  if (view === "agenda") return <CalendarAgenda {...props} />;
  return <CalendarMonth {...props} />;
}
