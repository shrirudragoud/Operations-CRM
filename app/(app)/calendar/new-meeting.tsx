"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CircleAlertIcon, PlusIcon } from "lucide-react";
import { DateField, TimeField } from "@/components/date-field";
import { InstitutionPicker } from "@/components/institution-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { checkBusy, scheduleMeeting, type BusyHit } from "@/lib/actions/meeting";
import { formatDate } from "@/lib/format";
import { DEPARTMENT_LABELS, DEPARTMENTS, type Department } from "@/lib/permissions";
import {
  FREQUENCIES, FREQUENCY_LABELS, MEETING_KINDS, MEETING_KIND_LABELS, VISIBILITY_LABELS, defaultEnd, formatTimeRange, scheduleMeetingSchema,
  type ScheduleMeetingInput, type ScheduleMeetingValues, type Visibility,
} from "@/lib/schemas/calendar";

export type PersonOption = { id: string; full_name: string; departments: string[] };

type Props = {
  me: { id: string; role: string; departments: Department[] };
  people: PersonOption[];
  today: string;
  /** Start the form on this day (a day clicked on the calendar). */
  day?: string;
  label?: string;
};

export function NewMeetingButton({ me, people, today, day, label = "New meeting" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}><PlusIcon aria-hidden /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {open && <MeetingForm me={me} people={people} today={today} day={day} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MeetingForm({ me, people, today, day, onDone }: Omit<Props, "label"> & { onDone: () => void }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyHit[]>([]);
  const [filter, setFilter] = useState("");
  const form = useForm<ScheduleMeetingInput, unknown, ScheduleMeetingValues>({
    resolver: zodResolver(scheduleMeetingSchema),
    defaultValues: {
      mode: "schedule", title: "", description: "", location: "", kind: "team", visibility: "invitees", department: "",
      date: day && day >= today ? day : today, start_time: "10:00", end_time: "10:30", attendees: [], institution_id: "",
      host_id: "", repeat: "none", ends_on: "", all_department: false,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const w = useWatch({ control: form.control });
  const mode = w.mode ?? "schedule";
  const attendees = w.attendees ?? [];
  const repeat = w.repeat ?? "none";
  const department = w.department ?? "";
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);

  const canDept = me.role === "founder" ? [...DEPARTMENTS] : me.role === "dept_lead" ? me.departments : [];
  const visibilities: Visibility[] = [
    "invitees",
    ...(canDept.length > 0 ? (["department"] as const) : []),
    ...(me.role === "founder" ? (["company"] as const) : []),
  ];
  const departmentChoices = w.visibility === "department" ? canDept : [...DEPARTMENTS];

  const key = `${w.date}|${w.start_time}|${w.end_time}|${attendees.join(",")}|${w.host_id}`;
  useEffect(() => {
    const ids = [me.id, ...attendees, ...(w.host_id ? [w.host_id] : [])];
    if (!w.date || !w.start_time || !w.end_time || repeat !== "none") return;
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await checkBusy({ staff_ids: [...new Set(ids)], date: w.date, start_time: w.start_time, end_time: w.end_time });
      if (!stale) setBusy(res.ok ? res.data : []);
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, repeat, me.id]);

  const shown = people.filter((p) => p.id !== me.id && p.full_name.toLowerCase().includes(filter.trim().toLowerCase()));
  const setAttendees = (ids: string[]) => form.setValue("attendees", ids, { shouldDirty: true, shouldValidate: true });

  async function onSubmit() {
    setServerError(null);
    const res = await scheduleMeeting(form.getValues());
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [k, msgs] of fields) form.setError(k as keyof ScheduleMeetingInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success(
      res.data.kind === "series" ? "Fixed meeting created. The next weeks appear on the calendar." : mode === "request" ? "Request sent" : "Meeting scheduled. Invitations are sent.",
    );
    onDone();
    router.push(res.data.kind === "series" ? "/calendar/series" : `/calendar/${res.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>{mode === "request" ? "Request a meeting" : "New meeting"}</DialogTitle>
        <DialogDescription>
          {mode === "request"
            ? "Ask one person for a time. They accept, decline, or suggest another time."
            : "Pick a time and invite people. They answer Going, Maybe or Not going. Make it repeat to fix a team meeting."}
        </DialogDescription>
      </DialogHeader>

      <div className="bg-muted inline-flex rounded-md p-0.5" role="group" aria-label="What to do">
        {(["schedule", "request"] as const).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? "default" : "ghost"}
            aria-pressed={mode === m}
            onClick={() => form.setValue("mode", m, { shouldDirty: true })}
          >
            {m === "schedule" ? "Schedule it" : "Ask for a time"}
          </Button>
        ))}
      </div>

      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="mt-title">Title</FieldLabel>
          <Input id="mt-title" autoComplete="off" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="mt-kind">Kind</FieldLabel>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="mt-kind" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{MEETING_KINDS.map((k) => <SelectItem key={k} value={k}>{MEETING_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field data-invalid={!!errors.location}>
            <FieldLabel htmlFor="mt-location">Place or link (optional)</FieldLabel>
            <Input id="mt-location" autoComplete="off" aria-invalid={!!errors.location} {...form.register("location")} />
            <FieldError errors={[errors.location]} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.date}>
            <FieldLabel htmlFor="mt-date">{repeat === "none" ? "Date" : "First date"}</FieldLabel>
            <Controller control={form.control} name="date" render={({ field }) => <DateField id="mt-date" value={field.value} onChange={field.onChange} min={today} invalid={!!errors.date} />} />
            <FieldError errors={[errors.date]} />
          </Field>
          <Field data-invalid={!!errors.start_time}>
            <FieldLabel htmlFor="mt-start">From (India time)</FieldLabel>
            <Controller
              control={form.control}
              name="start_time"
              render={({ field }) => (
                <TimeField
                  id="mt-start"
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    if (v) form.setValue("end_time", defaultEnd(v, 30), { shouldDirty: true });
                  }}
                  invalid={!!errors.start_time}
                />
              )}
            />
            <FieldError errors={[errors.start_time]} />
          </Field>
          <Field data-invalid={!!errors.end_time}>
            <FieldLabel htmlFor="mt-end">To</FieldLabel>
            <Controller control={form.control} name="end_time" render={({ field }) => <TimeField id="mt-end" value={field.value} onChange={field.onChange} invalid={!!errors.end_time} />} />
            <FieldError errors={[errors.end_time]} />
          </Field>
        </div>

        {busy.length > 0 && (
          <Alert role="status">
            <CircleAlertIcon aria-hidden />
            <AlertDescription>
              <p className="font-medium">Already booked at that time. You can still go ahead.</p>
              <ul className="mt-1 space-y-0.5">
                {busy.slice(0, 6).map((b, i) => (
                  <li key={`${b.staff_id}${i}`}>
                    {b.staff_id === me.id ? "You" : (names.get(b.staff_id) ?? "Someone")}: {formatDate(b.starts_at.slice(0, 10))} {formatTimeRange(b.starts_at, b.ends_at)} ({b.kind === "workshop" ? "workshop" : "meeting"})
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {mode === "request" ? (
          <Field data-invalid={!!errors.host_id}>
            <FieldLabel htmlFor="mt-host">Who are you asking?</FieldLabel>
            <Controller
              control={form.control}
              name="host_id"
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="mt-host" className="w-full" aria-invalid={!!errors.host_id}><SelectValue placeholder="Choose a person" /></SelectTrigger>
                  <SelectContent>{people.filter((p) => p.id !== me.id).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.host_id]} />
          </Field>
        ) : (
          <Field data-invalid={!!errors.attendees}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel htmlFor="mt-filter">Invite people ({attendees.length} chosen)</FieldLabel>
              {department && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAttendees([...new Set([...attendees, ...people.filter((p) => p.id !== me.id && p.departments.includes(department)).map((p) => p.id)])])}
                >
                  Add everyone in {DEPARTMENT_LABELS[department as Department]}
                </Button>
              )}
            </div>
            <Input id="mt-filter" placeholder="Search by name" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="People">
              {shown.map((p) => {
                const id = `mt-p-${p.id}`;
                return (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox id={id} checked={attendees.includes(p.id)} onCheckedChange={(on) => setAttendees(on ? [...attendees, p.id] : attendees.filter((x) => x !== p.id))} />
                    <label htmlFor={id}>{p.full_name}</label>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="text-muted-foreground text-sm">Nobody matches.</li>}
            </ul>
            <FieldError errors={[errors.attendees as { message?: string } | undefined]} />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.visibility}>
            <FieldLabel htmlFor="mt-visibility">Who can see it</FieldLabel>
            <Controller
              control={form.control}
              name="visibility"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="mt-visibility" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{visibilities.map((v) => <SelectItem key={v} value={v}>{VISIBILITY_LABELS[v]}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.visibility]} />
          </Field>
          <Field data-invalid={!!errors.department}>
            <FieldLabel htmlFor="mt-department">Department {w.visibility === "department" ? "" : "(optional)"}</FieldLabel>
            <Controller
              control={form.control}
              name="department"
              render={({ field }) => (
                <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                  <SelectTrigger id="mt-department" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {w.visibility !== "department" && <SelectItem value="none">None</SelectItem>}
                    {departmentChoices.map((d) => <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>A department lead can see and manage meetings of their department.</FieldDescription>
            <FieldError errors={[errors.department]} />
          </Field>
        </div>

        {mode === "schedule" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.repeat}>
                <FieldLabel htmlFor="mt-repeat">Repeats</FieldLabel>
                <Controller
                  control={form.control}
                  name="repeat"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="mt-repeat" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Does not repeat</SelectItem>
                        {FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.repeat]} />
              </Field>
              {repeat !== "none" && (
                <Field data-invalid={!!errors.ends_on}>
                  <FieldLabel htmlFor="mt-ends">Stops on (optional)</FieldLabel>
                  <Controller control={form.control} name="ends_on" render={({ field }) => <DateField id="mt-ends" value={field.value} onChange={field.onChange} invalid={!!errors.ends_on} />} />
                  <FieldError errors={[errors.ends_on]} />
                </Field>
              )}
            </div>
            {repeat !== "none" && (
              <Field data-invalid={!!errors.all_department}>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="mt-all">Everyone in the department</FieldLabel>
                  <Controller control={form.control} name="all_department" render={({ field }) => <Switch id="mt-all" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
                <FieldDescription>
                  {w.all_department
                    ? "Everyone in the department chosen above is invited, including people who join later. Only a founder or that department's lead can do this."
                    : "Only the people you picked are invited each time."}
                </FieldDescription>
              </Field>
            )}
          </>
        )}

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="mt-description">Notes (optional)</FieldLabel>
          <Textarea id="mt-description" rows={3} aria-invalid={!!errors.description} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>

        {repeat === "none" && (
          <Field>
            <FieldLabel htmlFor="mt-institution">About an institution (optional)</FieldLabel>
            <Controller control={form.control} name="institution_id" render={({ field }) => <InstitutionPicker id="mt-institution" value={field.value ?? ""} onChange={(id) => field.onChange(id)} invalid={false} />} />
          </Field>
        )}
      </FieldGroup>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />} {mode === "request" ? "Send request" : repeat !== "none" ? "Create fixed meeting" : "Schedule meeting"}
        </Button>
      </DialogFooter>
    </form>
  );
}
