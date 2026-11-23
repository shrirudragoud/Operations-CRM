"use client";

import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { TrashIcon } from "lucide-react";
import { DateField, TimeField } from "@/components/date-field";
import { TrustNetworkButton } from "@/components/attendance-controls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { addHoliday, addNetwork, removeHoliday, removeNetwork, saveOfficeSettings, setNetworkActive } from "@/lib/actions/attendance";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  holidaySchema, IP_HEADERS, networkSchema, settingsSchema,
  type HolidayInput, type NetworkInput, type SettingsInput, type SettingsValues,
} from "@/lib/schemas/attendance";

const DAYS = [
  { n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" }, { n: 4, label: "Thu" },
  { n: 5, label: "Fri" }, { n: 6, label: "Sat" }, { n: 7, label: "Sun" },
];

export type SettingsView = {
  start_time: string; end_time: string; grace_minutes: number; work_days: number[]; flags_on: boolean; ip_header: string; ip_hops: number;
};

const hhmm = (t: string) => t.slice(0, 5);

export function HoursForm({ settings }: { settings: SettingsView }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SettingsInput, unknown, SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      start_time: hhmm(settings.start_time), end_time: hhmm(settings.end_time), grace_minutes: String(settings.grace_minutes),
      work_days: settings.work_days, flags_on: settings.flags_on, ip_header: settings.ip_header as (typeof IP_HEADERS)[number], ip_hops: String(settings.ip_hops),
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: SettingsValues) {
    setServerError(null);
    const res = await saveOfficeSettings(v);
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof SettingsInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Office settings saved");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.start_time}>
            <FieldLabel htmlFor="set-start">Opens</FieldLabel>
            <Controller control={form.control} name="start_time" render={({ field }) => <TimeField id="set-start" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.start_time} />} />
            <FieldError errors={[errors.start_time]} />
          </Field>
          <Field data-invalid={!!errors.end_time}>
            <FieldLabel htmlFor="set-end">Closes</FieldLabel>
            <Controller control={form.control} name="end_time" render={({ field }) => <TimeField id="set-end" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.end_time} />} />
            <FieldError errors={[errors.end_time]} />
          </Field>
          <Field data-invalid={!!errors.grace_minutes}>
            <FieldLabel htmlFor="set-grace">Leeway (minutes)</FieldLabel>
            <Input id="set-grace" inputMode="numeric" aria-invalid={!!errors.grace_minutes} {...form.register("grace_minutes")} />
            <FieldDescription>Arrive this long after opening, or leave this long before closing, and it is still on time.</FieldDescription>
            <FieldError errors={[errors.grace_minutes]} />
          </Field>
        </div>

        <Field data-invalid={!!errors.work_days}>
          <FieldLabel>Working days</FieldLabel>
          <Controller
            control={form.control}
            name="work_days"
            render={({ field }) => (
              <div className="flex flex-wrap gap-4" role="group" aria-label="Working days">
                {DAYS.map((d) => (
                  <label key={d.n} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(d.n)}
                      onCheckedChange={(c) => field.onChange(c === true ? [...field.value, d.n] : field.value.filter((x) => x !== d.n))}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            )}
          />
          <FieldError errors={[errors.work_days as { message?: string } | undefined]} />
        </Field>

        <Field orientation="horizontal">
          <Controller control={form.control} name="flags_on" render={({ field }) => <Switch id="set-flags" checked={field.value} onCheckedChange={field.onChange} />} />
          <div className="space-y-1">
            <FieldLabel htmlFor="set-flags">Show late, early and absent</FieldLabel>
            <FieldDescription>
              Off is a trial week: times are recorded, but nobody is marked late or absent. Turn it on when the office network is working for everyone.
            </FieldDescription>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.ip_header}>
            <FieldLabel htmlFor="set-header">Where the network address is read from</FieldLabel>
            <Controller
              control={form.control}
              name="ip_header"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="set-header" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{IP_HEADERS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
            <FieldDescription>Leave as it is unless check-in cannot read your address. Cloudflare sets cf-connecting-ip.</FieldDescription>
            <FieldError errors={[errors.ip_header]} />
          </Field>
          <Field data-invalid={!!errors.ip_hops}>
            <FieldLabel htmlFor="set-hops">Proxies in front (for x-forwarded-for only)</FieldLabel>
            <Input id="set-hops" inputMode="numeric" aria-invalid={!!errors.ip_hops} {...form.register("ip_hops")} />
            <FieldError errors={[errors.ip_hops]} />
          </Field>
        </div>
      </FieldGroup>
      {serverError && <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>}
      <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save settings</Button>
    </form>
  );
}

export type HolidayRow = { id: string; holiday_date: string; name: string };

export function HolidaysPanel({ holidays, today }: { holidays: HolidayRow[]; today: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<HolidayInput>({ resolver: zodResolver(holidaySchema), defaultValues: { holiday_date: today, name: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(v: HolidayInput) {
    setServerError(null);
    const res = await addHoliday(v);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    toast.success("Holiday added");
    form.reset({ holiday_date: v.holiday_date, name: "" });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-wrap items-start gap-3">
        <Field className="w-44" data-invalid={!!errors.holiday_date}>
          <FieldLabel htmlFor="hol-date" className="sr-only">Day</FieldLabel>
          <Controller control={form.control} name="holiday_date" render={({ field }) => <DateField id="hol-date" value={field.value} onChange={field.onChange} clearable={false} invalid={!!errors.holiday_date} />} />
          <FieldError errors={[errors.holiday_date]} />
        </Field>
        <Field className="w-56" data-invalid={!!errors.name}>
          <FieldLabel htmlFor="hol-name" className="sr-only">Name</FieldLabel>
          <Input id="hol-name" placeholder="Diwali" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Button type="submit" variant="outline" disabled={isSubmitting}>{isSubmitting && <Spinner />} Add holiday</Button>
      </form>
      {serverError && <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>}
      {holidays.length === 0 ? (
        <p className="text-muted-foreground text-sm">No upcoming holidays. Add the days the office is closed so nobody is marked absent.</p>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Upcoming holidays">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span><span className="font-medium">{h.name}</span> <span className="text-muted-foreground">{formatDate(h.holiday_date)}</span></span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${h.name}`}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await removeHoliday({ id: h.id });
                    if (!res.ok) toast.error(res.error);
                  })
                }
              >
                <TrashIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type NetworkRow = { id: string; label: string; cidr: string; is_active: boolean; last_seen_at: string | null };

export function NetworksPanel({ networks }: { networks: NetworkRow[] }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<NetworkInput>({ resolver: zodResolver(networkSchema), defaultValues: { label: "", cidr: "" } });
  const { errors, isSubmitting } = form.formState;
  const label = useWatch({ control: form.control, name: "label" });

  async function onSubmit(v: NetworkInput) {
    setServerError(null);
    const res = await addNetwork(v);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    toast.success("Network added");
    form.reset({ label: "", cidr: "" });
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TrustNetworkButton label={label} />
        <p className="text-muted-foreground max-w-xl text-sm">
          Open this page on the office Wi-Fi and press this. It saves the connection you are on, so staff on it can check in. Give it a name below first if you like.
        </p>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-wrap items-start gap-3">
        <Field className="w-48" data-invalid={!!errors.label}>
          <FieldLabel htmlFor="net-label" className="sr-only">Name</FieldLabel>
          <Input id="net-label" placeholder="Office Wi-Fi" autoComplete="off" aria-invalid={!!errors.label} {...form.register("label")} />
          <FieldError errors={[errors.label]} />
        </Field>
        <Field className="w-64" data-invalid={!!errors.cidr}>
          <FieldLabel htmlFor="net-cidr" className="sr-only">Address or range</FieldLabel>
          <Input id="net-cidr" placeholder="203.0.113.10 or 203.0.113.0/24" autoComplete="off" aria-invalid={!!errors.cidr} {...form.register("cidr")} />
          <FieldError errors={[errors.cidr]} />
        </Field>
        <Button type="submit" variant="outline" disabled={isSubmitting}>{isSubmitting && <Spinner />} Add by hand</Button>
      </form>
      {serverError && <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>}
      {networks.length === 0 ? (
        <Alert><AlertDescription>No office network yet, so nobody can check in. Press Trust this network while on the office Wi-Fi.</AlertDescription></Alert>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Office networks">
          {networks.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{n.label}</span>
                  <Badge variant={n.is_active ? "secondary" : "outline"}>{n.is_active ? "In use" : "Paused"}</Badge>
                </div>
                <div className="text-muted-foreground text-xs">
                  <code>{n.cidr}</code>
                  {n.last_seen_at ? ` · last used ${formatDateTime(n.last_seen_at)}` : " · not used yet"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setNetworkActive({ id: n.id, is_active: !n.is_active }))}>
                  {n.is_active ? "Pause" : "Resume"}
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${n.label}`} disabled={pending} onClick={() => act(() => removeNetwork({ id: n.id }))}>
                  <TrashIcon aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
