"use client";

import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveDealLines, updateDeal } from "@/lib/actions/deal";
import { formatINR } from "@/lib/format";
import { dealLinesSchema, linesTotal, type DealLinesInput } from "@/lib/schemas/deal";
import type { DealDetailsValues } from "./deal-details-form";

export type LineValues = { description: string; qty: string; unit_price_inr: string };

/** Proposal lines saved as one set (ops.replace_deal_lines). The deal value is separate; one button copies the total across. */
export function LinesEditor({
  dealId, initial, savedTotal, details, dealValue,
}: { dealId: string; initial: LineValues[]; savedTotal: number; details: DealDetailsValues; dealValue: number }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<DealLinesInput, unknown, ReturnType<typeof dealLinesSchema.parse>>({
    resolver: zodResolver(dealLinesSchema),
    defaultValues: { deal_id: dealId, lines: initial },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const { errors, isSubmitting, isDirty } = form.formState;
  const watched = useWatch({ control: form.control, name: "lines" });
  const draftTotal = linesTotal(watched.map((l) => ({ qty: Number(l.qty) || 0, unit_price_inr: Number(l.unit_price_inr) || 0 })));

  async function onSubmit() {
    setServerError(null);
    const res = await saveDealLines(form.getValues());
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    toast.success("Lines saved");
    form.reset(form.getValues());
  }

  function useTotalAsValue() {
    setServerError(null);
    startTransition(async () => {
      const res = await updateDeal({ ...details, value_inr: String(savedTotal) });
      if (!res.ok) {
        setServerError(res.error);
        return;
      }
      toast.success(`Deal value set to ${formatINR(savedTotal)}`);
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      {fields.length === 0 ? (
        <p className="text-muted-foreground text-sm">No lines yet. Add what the proposal includes (kits, trainer days, sessions).</p>
      ) : (
        <div className="space-y-3">
          {fields.map((f, i) => {
            const e = errors.lines?.[i];
            const line = watched[i];
            return (
              <div key={f.id} className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_8rem_auto] sm:items-start">
                <div>
                  <Input aria-label={`Line ${i + 1} description`} placeholder="Description" autoComplete="off" aria-invalid={!!e?.description} {...form.register(`lines.${i}.description`)} />
                  <FieldError errors={[e?.description]} />
                </div>
                <div>
                  <Input aria-label={`Line ${i + 1} quantity`} placeholder="Qty" inputMode="decimal" autoComplete="off" aria-invalid={!!e?.qty} {...form.register(`lines.${i}.qty`)} />
                  <FieldError errors={[e?.qty]} />
                </div>
                <div>
                  <Input aria-label={`Line ${i + 1} unit price`} placeholder="Unit price" inputMode="decimal" autoComplete="off" aria-invalid={!!e?.unit_price_inr} {...form.register(`lines.${i}.unit_price_inr`)} />
                  <FieldError errors={[e?.unit_price_inr]} />
                </div>
                <div className="text-muted-foreground flex h-9 items-center text-sm sm:justify-end">
                  {formatINR(linesTotal([{ qty: Number(line?.qty) || 0, unit_price_inr: Number(line?.unit_price_inr) || 0 }]))}
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => remove(i)}>
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <FieldError errors={[errors.lines?.root ?? errors.lines]} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => append({ description: "", qty: "1", unit_price_inr: "" })}>
          <PlusIcon aria-hidden /> Add line
        </Button>
        <Button type="submit" disabled={isSubmitting || !isDirty}>{isSubmitting && <Spinner />} Save lines</Button>
        <span className="ml-auto text-sm font-medium">Total {formatINR(draftTotal)}</span>
      </div>

      {!isDirty && savedTotal > 0 && savedTotal !== dealValue && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            The lines add up to {formatINR(savedTotal)} but the deal value is {formatINR(dealValue)}.
            <Button type="button" size="sm" variant="outline" onClick={useTotalAsValue} disabled={pending}>
              {pending && <Spinner />} Use lines total as deal value
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
