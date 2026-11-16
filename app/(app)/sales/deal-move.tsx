"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRightLeftIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { moveDeal } from "@/lib/actions/deal";
import {
  DEAL_KIND_LABELS, DEAL_STAGE_LABELS, STAGE_PROBABILITY, allowedMoves, moveDealSchema, wonOutcome,
  type DealKind, type DealStage,
} from "@/lib/schemas/deal";

export type MovableDeal = { id: string; title: string; kind: DealKind; stage: DealStage; probability: number | null };

/** Stage menu + dialog. Won is offered to the founder only; Lost asks for a reason; the database has the last word. */
export function DealMoveMenu({
  deal, canWon, compact = false,
}: { deal: MovableDeal; canWon: boolean; compact?: boolean }) {
  const [target, setTarget] = useState<DealStage | null>(null);
  const moves = allowedMoves(deal.stage).filter((s) => s !== "won" || canWon);
  if (moves.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={compact ? "sm" : "default"} aria-label={`Move ${deal.title}`}>
            <ArrowRightLeftIcon aria-hidden /> {compact ? "Move" : "Move stage"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {moves.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => setTarget(s)}>
              {s === "won" ? "Mark won" : s === "lost" ? "Mark lost" : DEAL_STAGE_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          {target && <MoveForm key={target} deal={deal} target={target} onDone={() => setTarget(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MoveForm({ deal, target, onDone }: { deal: MovableDeal; target: DealStage; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [probability, setProbability] = useState(String(deal.probability ?? STAGE_PROBABILITY[target]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = target === "won" ? "Mark this deal won?" : target === "lost" ? "Mark this deal lost?" : `Move to ${DEAL_STAGE_LABELS[target]}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const input = { id: deal.id, stage: target, lost_reason: reason, probability: target === "won" || target === "lost" ? "" : probability };
    const parsed = moveDealSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await moveDeal(input);
      if (!res.ok) {
        setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
        setServerError(res.error);
        return;
      }
      toast.success(target === "won" ? "Deal won" : `Moved to ${DEAL_STAGE_LABELS[target]}`, {
        description: res.data.created.length ? `Created: ${res.data.created.join("; ")}` : undefined,
      });
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{deal.title} · {DEAL_KIND_LABELS[deal.kind]} · now at {DEAL_STAGE_LABELS[deal.stage]}</DialogDescription>
      </DialogHeader>

      {target === "won" && (
        <Alert>
          <AlertDescription>
            <p>Winning is final and cannot be undone. It creates:</p>
            <ul className="mt-1 list-disc pl-5">{wonOutcome(deal.kind).map((t) => <li key={t}>{t}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      {target === "lost" && (
        <Field data-invalid={!!errors.lost_reason}>
          <FieldLabel htmlFor="move-reason">Why was it lost?</FieldLabel>
          <Textarea id="move-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.lost_reason} />
          <FieldError errors={errors.lost_reason ? [{ message: errors.lost_reason }] : undefined} />
        </Field>
      )}

      {target !== "won" && target !== "lost" && (
        <Field data-invalid={!!errors.probability}>
          <FieldLabel htmlFor="move-probability">Chance of winning (%)</FieldLabel>
          <Input id="move-probability" inputMode="numeric" autoComplete="off" value={probability} onChange={(e) => setProbability(e.target.value)} aria-invalid={!!errors.probability} />
          <FieldDescription>Used for the weighted forecast. Adjust it to your own read of the deal.</FieldDescription>
          <FieldError errors={errors.probability ? [{ message: errors.probability }] : undefined} />
        </Field>
      )}

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" variant={target === "lost" ? "destructive" : "default"} disabled={pending}>
          {pending && <Spinner />} {target === "won" ? "Mark won" : target === "lost" ? "Mark lost" : "Move"}
        </Button>
      </DialogFooter>
    </form>
  );
}
