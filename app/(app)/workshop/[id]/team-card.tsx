"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { listAvailableTrainers, setEventTeam, type TrainerOption } from "@/lib/actions/event";
import { MAX_ASSISTANTS } from "@/lib/schemas/event";

const NONE = "none";

type Person = { id: string; name: string };

/**
 * Lead trainer + up to two assistants, saved as one set. The list is certified trainers and founders for
 * the saved dates, with busy people disabled; the database re-checks certification and double-booking.
 */
export function TeamCard({
  eventId, startLocal, endLocal, lead, assistants,
}: { eventId: string; startLocal: string; endLocal: string; lead: Person | null; assistants: Person[] }) {
  const hasDates = startLocal !== "" && endLocal !== "";
  const [options, setOptions] = useState<TrainerOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leadId, setLeadId] = useState(lead?.id ?? NONE);
  const [picked, setPicked] = useState<string[]>(
    Array.from({ length: MAX_ASSISTANTS }, (_, i) => assistants[i]?.id ?? NONE),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!hasDates) return;
    let stale = false;
    listAvailableTrainers({ starts_at: startLocal, ends_at: endLocal, exclude_event: eventId }).then((res) => {
      if (stale) return;
      if (res.ok) setOptions(res.data);
      else setLoadError(res.error);
    });
    return () => {
      stale = true;
    };
  }, [hasDates, startLocal, endLocal, eventId]);

  if (!hasDates) {
    return <p className="text-muted-foreground text-sm">Save the start and end first. Then you can pick a trainer who is free for those dates.</p>;
  }

  // Keep people who are already on the team selectable even if they are not in the certified list.
  const known = new Map<string, { name: string; free: boolean }>();
  for (const o of options ?? []) known.set(o.staff_id, { name: o.full_name, free: o.is_free });
  for (const p of [lead, ...assistants]) if (p && !known.has(p.id)) known.set(p.id, { name: p.name, free: true });
  const all = [...known.entries()];

  const assistantIds = picked.filter((p) => p !== NONE);
  const dirty =
    leadId !== (lead?.id ?? NONE) ||
    assistantIds.slice().sort().join() !== assistants.map((a) => a.id).sort().join();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setEventTeam({
        id: eventId,
        lead_trainer_id: leadId === NONE ? "" : leadId,
        assistants: assistantIds,
      });
      if (!res.ok) {
        setError(res.fieldErrors?.assistants?.[0] ?? res.error);
        return;
      }
      toast.success("Team saved");
    });
  }

  const item = ([id, o]: [string, { name: string; free: boolean }], taken: string[]) => (
    <SelectItem key={id} value={id} disabled={!o.free || taken.includes(id)}>
      {o.name}{o.free ? "" : " (busy)"}
    </SelectItem>
  );

  return (
    <div className="space-y-4">
      {options === null && !loadError && <p className="text-muted-foreground text-sm" role="status">Checking who is free...</p>}
      {loadError && (
        <Alert variant="destructive" role="alert"><AlertDescription>{loadError}</AlertDescription></Alert>
      )}
      <Field>
        <FieldLabel htmlFor="team-lead">Lead trainer</FieldLabel>
        <Select value={leadId} onValueChange={setLeadId}>
          <SelectTrigger id="team-lead" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not assigned</SelectItem>
            {all.map((e) => item(e, assistantIds))}
          </SelectContent>
        </Select>
        <FieldDescription>Must be certified (or the founder) and free for these dates.</FieldDescription>
      </Field>
      {picked.map((value, i) => (
        <Field key={i}>
          <FieldLabel htmlFor={`team-assistant-${i}`}>Assistant {i + 1} (optional)</FieldLabel>
          <Select value={value} onValueChange={(v) => setPicked((p) => p.map((x, j) => (j === i ? v : x)))}>
            <SelectTrigger id={`team-assistant-${i}`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {all.map((e) => item(e, [leadId, ...picked.filter((_, j) => j !== i)]))}
            </SelectContent>
          </Select>
        </Field>
      ))}
      {error && (
        <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>
      )}
      <Button type="button" onClick={save} disabled={pending || !dirty}>{pending && <Spinner />} Save team</Button>
    </div>
  );
}
