"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { BacklogPoint, DayPoint, LateBand, PlanPoint, WeekdayPoint } from "@/lib/ops-insight";

// Charts for the Cockpit's Operations view. Colours are written out (not theme tokens) so early, on time and late
// stay distinct; every chart also has a text summary for screen readers and the drill-down links sit beside it.

const COLORS = { early: "#10b981", onTime: "#0ea5e9", late: "#ef4444", noDeadline: "#94a3b8", created: "#f59e0b", open: "#6366f1" };

function Figure({ label, summary, children }: { label: string; summary: string; children: React.ReactNode }) {
  return (
    <figure aria-label={label}>
      {children}
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

const doneConfig = {
  early: { label: "Early", color: COLORS.early },
  onTime: { label: "On time", color: COLORS.onTime },
  late: { label: "Late", color: COLORS.late },
  noDeadline: { label: "No deadline", color: COLORS.noDeadline },
  created: { label: "Created", color: COLORS.created },
} satisfies ChartConfig;

/** Finished work per day, early / on time / late stacked, with what was created as a line. */
export function DoneChart({ data, summary }: { data: DayPoint[]; summary: string }) {
  return (
    <Figure label="Tasks finished per day" summary={summary}>
      <ChartContainer config={doneConfig} className="h-64 w-full">
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="early" stackId="done" fill="var(--color-early)" />
          <Bar dataKey="onTime" stackId="done" fill="var(--color-onTime)" />
          <Bar dataKey="late" stackId="done" fill="var(--color-late)" />
          <Bar dataKey="noDeadline" stackId="done" fill="var(--color-noDeadline)" radius={[3, 3, 0, 0]} />
          <Line dataKey="created" type="monotone" stroke="var(--color-created)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ChartContainer>
    </Figure>
  );
}

const backlogConfig = {
  open: { label: "Open", color: COLORS.open },
  overdue: { label: "Overdue", color: COLORS.late },
  blocked: { label: "Blocked", color: COLORS.created },
} satisfies ChartConfig;

/** What was open, overdue and blocked at the start of each day. */
export function BacklogChart({ data, summary }: { data: BacklogPoint[]; summary: string }) {
  return (
    <Figure label="Open, overdue and blocked work over time" summary={summary}>
      <ChartContainer config={backlogConfig} className="h-64 w-full">
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area dataKey="open" type="monotone" stroke="var(--color-open)" fill="var(--color-open)" fillOpacity={0.15} strokeWidth={2} />
          <Area dataKey="overdue" type="monotone" stroke="var(--color-overdue)" fill="var(--color-overdue)" fillOpacity={0.2} strokeWidth={2} />
          <Area dataKey="blocked" type="monotone" stroke="var(--color-blocked)" fill="var(--color-blocked)" fillOpacity={0.15} strokeWidth={2} />
        </AreaChart>
      </ChartContainer>
    </Figure>
  );
}

const weekdayConfig = {
  avgDone: { label: "Finished per day (average)", color: COLORS.onTime },
  lateRate: { label: "Late (%)", color: COLORS.late },
} satisfies ChartConfig;

/** Average finished per weekday, and how often that day's work was late. */
export function WeekdayChart({ data, summary }: { data: WeekdayPoint[]; summary: string }) {
  return (
    <Figure label="Work finished by weekday" summary={summary}>
      <ChartContainer config={weekdayConfig} className="h-56 w-full">
        <ComposedChart data={data} margin={{ left: 0, right: 0, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis yAxisId="n" allowDecimals width={28} tickLine={false} axisLine={false} />
          <YAxis yAxisId="p" orientation="right" domain={[0, 100]} width={34} tickLine={false} axisLine={false} unit="%" />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="n" dataKey="avgDone" fill="var(--color-avgDone)" radius={[3, 3, 0, 0]} />
          <Line yAxisId="p" dataKey="lateRate" type="monotone" stroke="var(--color-lateRate)" strokeWidth={2} connectNulls={false} />
        </ComposedChart>
      </ChartContainer>
    </Figure>
  );
}

const bandConfig = { count: { label: "Tasks", color: COLORS.late } } satisfies ChartConfig;

/** A small bar chart of late work by how late it was (or by how long it has waited). */
export function BandChart({ data, label, summary }: { data: LateBand[]; label: string; summary: string }) {
  return (
    <Figure label={label} summary={summary}>
      <ChartContainer config={bandConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="band" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </Figure>
  );
}

const planConfig = { logged: { label: "Time logged (min)", color: COLORS.onTime } } satisfies ChartConfig;

/** Estimate (across) against time logged (up) for finished tasks; the dashed line is "exactly as planned". */
export function PlanChart({ data, summary }: { data: PlanPoint[]; summary: string }) {
  const max = Math.max(60, ...data.map((d) => Math.max(d.estimate, d.logged)));
  return (
    <Figure label="Estimate against time logged" summary={summary}>
      <ChartContainer config={planConfig} className="h-64 w-full">
        <ScatterChart margin={{ left: 0, right: 8, top: 8, bottom: 16 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="estimate" name="Estimate" unit=" min" domain={[0, max]} tickLine={false} label={{ value: "Estimate", position: "insideBottom", offset: -8 }} />
          <YAxis type="number" dataKey="logged" name="Logged" unit=" min" domain={[0, max]} width={52} tickLine={false} />
          <ZAxis range={[60, 60]} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="#94a3b8" strokeDasharray="4 4" />
          <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTooltipContent hideLabel />} />
          <Scatter data={data} fill="var(--color-logged)" />
        </ScatterChart>
      </ChartContainer>
    </Figure>
  );
}
