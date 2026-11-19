"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckIcon, CircleHelpIcon, PencilIcon, UserMinusIcon, UserPlusIcon, XIcon } from "lucide-react";
import { DateField, TimeField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  addAttendee, answerMeetingRequest, cancelMeeting, removeAttendee, respondToMeeting, respondToSeries, updateMeeting, withdrawRequest,
} from "@/lib/actions/meeting";
import { DEPARTMENT_LABELS, DEPARTMENTS, type Department } from "@/lib/permissions";
import {
  MEETING_KINDS, MEETING_KIND_LABELS, VISIBILITY_LABELS, defaultEnd, updateMeetingSchema, type Rsvp, type UpdateMeetingInput, type Visibility,
} from "@/lib/schemas/calendar";

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

function useRun() {
  const [pending, startTransition] = useTransition();
  const run: Run = (fn, done) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Something went wrong.");
      else toast.success(done);
    });
  return { pending, run };
}

// ---------------------------------------------------------------- invitation answers

export function RsvpButtons({ meetingId, current, seriesId }: { meetingId: string; current: Rsvp; seriesId?: string | null }) {
  const { pending, run } = useRun();
  const options: { rsvp: "accepted" | "tentative" | "declined"; label: string; icon: typeof CheckIcon }[] = [
    { rsvp: "accepted", label: "Going", icon: CheckIcon },
    { rsvp: "tentative", label: "Maybe", icon: CircleHelpIcon },
    { rsvp: "declined", label: "Not going", icon: XIcon },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={seriesId ? "Your answer for this one" : "Your answer"}>
        {options.map((o) => (
          <Button
            key={o.rsvp}
            size="sm"
            variant={current === o.rsvp ? "default" : "outline"}
            aria-pressed={current === o.rsvp}
            disabled={pending}
            onClick={() => run(() => respondToMeeting({ meeting_id: meetingId, rsvp: o.rsvp }), `Answered: ${o.label}`)}
          >
            <o.icon aria-hidden /> {seriesId ? `${o.label}, only this one` : o.label}
          </Button>
        ))}
      </div>
      {seriesId && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your answer for every upcoming one">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => respondToSeries({ series_id: seriesId, rsvp: "accepted" }), "Going to every upcoming one")}>
            <CheckIcon aria-hidden /> Going to all upcoming
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => respondToSeries({ series_id: seriesId, rsvp: "declined" }), "Not going to any upcoming one")}>
            <XIcon aria-hidden /> Not going to any
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- request answers

export function RequestAnswer({ meetingId, date, start, end }: { meetingId: string; date: string; start: string; end: string }) {
  const router = useRouter();
  const { pending, run } = useRun();
  const [dialog, setDialog] = useState<"decline" | "propose" | null>(null);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState({ date, start, end });
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "decline" | "propose") {
    setError(null);
    const res = await answerMeetingRequest(
      action === "decline" ? { id: meetingId, action, note } : { id: meetingId, action, note, date: when.date, start_time: when.start, end_time: when.end },
    );
    if (!res.ok) {
      setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.error);
      return;
    }
    toast.success(action === "decline" ? "Request declined" : "Another time suggested");
    setDialog(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Answer the request">
        <Button size="sm" disabled={pending} onClick={() => run(() => answerMeetingRequest({ id: meetingId, action: "accept" }), "Accepted. It is on the calendar.")}>
          <CheckIcon aria-hidden /> Accept
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setError(null); setDialog("propose"); }}>Suggest another time</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setError(null); setDialog("decline"); }}>Decline</Button>
      </div>
      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); if (dialog) void submit(dialog); }} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{dialog === "decline" ? "Decline this request" : "Suggest another time"}</DialogTitle>
              <DialogDescription>
                {dialog === "decline" ? "Say why, so they can ask again with a better time." : "They get your time and can accept it, or suggest another."}
              </DialogDescription>
            </DialogHeader>
            {dialog === "propose" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field><FieldLabel htmlFor="ra-date">Date</FieldLabel><DateField id="ra-date" value={when.date} onChange={(v) => setWhen((w) => ({ ...w, date: v }))} /></Field>
                <Field><FieldLabel htmlFor="ra-start">From</FieldLabel><TimeField id="ra-start" value={when.start} onChange={(v) => setWhen((w) => ({ ...w, start: v, end: v ? defaultEnd(v, 30) : w.end }))} /></Field>
                <Field><FieldLabel htmlFor="ra-end">To</FieldLabel><TimeField id="ra-end" value={when.end} onChange={(v) => setWhen((w) => ({ ...w, end: v }))} /></Field>
              </div>
            )}
            <Textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={dialog === "decline" ? "Why you are declining" : "Note (optional)"}
              placeholder={dialog === "decline" ? "Why are you declining?" : "Note (optional)"}
              autoFocus={dialog === "decline"}
            />
            {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Back</Button>
              <Button type="submit" disabled={dialog === "decline" && !note.trim()}>{dialog === "decline" ? "Decline request" : "Send suggestion"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- cancel and withdraw

export function CancelMeeting({ meetingId, title, request }: { meetingId: string; title: string; request: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = request && !reason.trim() ? await withdrawRequest({ id: meetingId }) : await cancelMeeting({ id: meetingId, reason });
      if (!res.ok) {
        setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.error);
        return;
      }
      toast.success(request ? "Request withdrawn" : "Meeting cancelled. People are told.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{request ? "Withdraw request" : "Cancel meeting"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{request ? "Withdraw this request" : "Cancel this meeting"}</DialogTitle>
              <DialogDescription>{title}</DialogDescription>
            </DialogHeader>
            <Textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Why it is cancelled"
              placeholder={request ? "Reason (optional)" : "Why is it cancelled?"}
              autoFocus
            />
            {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep it</Button>
              <Button type="submit" variant="destructive" disabled={pending || (!request && !reason.trim())}>{pending && <Spinner />} {request ? "Withdraw" : "Cancel meeting"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- edit

export type EditInitial = {
  id: string; title: string; description: string; location: string; kind: UpdateMeetingInput["kind"]; visibility: Visibility;
  department: UpdateMeetingInput["department"]; date: string; start_time: string; end_time: string; institution_id: string;
};

export function EditMeeting({ initial, me, series }: { initial: EditInitial; me: { role: string; departments: Department[] }; series: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<UpdateMeetingInput, unknown, ReturnType<typeof updateMeetingSchema.parse>>({
    resolver: zodResolver(updateMeetingSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting } = form.formState;
  const canDept = me.role === "founder" ? [...DEPARTMENTS] : me.role === "dept_lead" ? me.departments : [];
  const visibilities: Visibility[] = [
    "invitees",
    ...(canDept.length > 0 || initial.visibility === "department" ? (["department"] as const) : []),
    ...(me.role === "founder" || initial.visibility === "company" ? (["company"] as const) : []),
  ];

  async function onSubmit() {
    setServerError(null);
    const res = await updateMeeting(form.getValues());
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [k, msgs] of fields) form.setError(k as keyof UpdateMeetingInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Meeting updated");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { form.reset(initial); setServerError(null); setOpen(true); }}><PencilIcon aria-hidden /> Edit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
            <DialogHeader>
              <DialogTitle>Edit meeting</DialogTitle>
              <DialogDescription>
                {series ? "This only changes this one meeting of a fixed series. Change the series from Fixed meetings." : "Moving it asks everyone to answer again."}
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={!!errors.title}>
                <FieldLabel htmlFor="em-title">Title</FieldLabel>
                <Input id="em-title" autoComplete="off" aria-invalid={!!errors.title} {...form.register("title")} />
                <FieldError errors={[errors.title]} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="em-kind">Kind</FieldLabel>
                  <Controller control={form.control} name="kind" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="em-kind" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{MEETING_KINDS.map((k) => <SelectItem key={k} value={k}>{MEETING_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                </Field>
                <Field data-invalid={!!errors.location}>
                  <FieldLabel htmlFor="em-location">Place or link</FieldLabel>
                  <Input id="em-location" autoComplete="off" {...form.register("location")} />
                  <FieldError errors={[errors.location]} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field data-invalid={!!errors.date}>
                  <FieldLabel htmlFor="em-date">Date</FieldLabel>
                  <Controller control={form.control} name="date" render={({ field }) => <DateField id="em-date" value={field.value} onChange={field.onChange} invalid={!!errors.date} />} />
                  <FieldError errors={[errors.date]} />
                </Field>
                <Field data-invalid={!!errors.start_time}>
                  <FieldLabel htmlFor="em-start">From (India time)</FieldLabel>
                  <Controller control={form.control} name="start_time" render={({ field }) => <TimeField id="em-start" value={field.value} onChange={field.onChange} invalid={!!errors.start_time} />} />
                  <FieldError errors={[errors.start_time]} />
                </Field>
                <Field data-invalid={!!errors.end_time}>
                  <FieldLabel htmlFor="em-end">To</FieldLabel>
                  <Controller control={form.control} name="end_time" render={({ field }) => <TimeField id="em-end" value={field.value} onChange={field.onChange} invalid={!!errors.end_time} />} />
                  <FieldError errors={[errors.end_time]} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.visibility}>
                  <FieldLabel htmlFor="em-visibility">Who can see it</FieldLabel>
                  <Controller control={form.control} name="visibility" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="em-visibility" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{visibilities.map((v) => <SelectItem key={v} value={v}>{VISIBILITY_LABELS[v]}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                  <FieldError errors={[errors.visibility]} />
                </Field>
                <Field data-invalid={!!errors.department}>
                  <FieldLabel htmlFor="em-department">Department</FieldLabel>
                  <Controller control={form.control} name="department" render={({ field }) => (
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <SelectTrigger id="em-department" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                  <FieldError errors={[errors.department]} />
                </Field>
              </div>
              <Field data-invalid={!!errors.description}>
                <FieldLabel htmlFor="em-description">Notes</FieldLabel>
                <Textarea id="em-description" rows={3} {...form.register("description")} />
                <FieldError errors={[errors.description]} />
              </Field>
            </FieldGroup>
            {serverError && <Alert variant="destructive" role="alert"><AlertDescription>{serverError}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- people

export function InviteMore({ meetingId, options }: { meetingId: string; options: { id: string; full_name: string }[] }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState<string>("");
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value || undefined} onValueChange={setValue}>
        <SelectTrigger className="w-56" aria-label="Invite someone"><SelectValue placeholder="Invite someone" /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}</SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !value}
        onClick={() => { const id = value; setValue(""); run(() => addAttendee({ meeting_id: meetingId, staff_id: id }), "Invited"); }}
      >
        <UserPlusIcon aria-hidden /> Invite
      </Button>
    </div>
  );
}

export function RemoveAttendee({ meetingId, staffId, name }: { meetingId: string; staffId: string; name: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-7"
      aria-label={`Remove ${name}`}
      disabled={pending}
      onClick={() => run(() => removeAttendee({ meeting_id: meetingId, staff_id: staffId }), "Removed")}
    >
      <UserMinusIcon aria-hidden />
    </Button>
  );
}
