"use client";

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
} from "@ui-sdk/react/combobox";

export type PickerPerson = { id: string; full_name: string };

type Props = {
  id: string;
  people: PickerPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  meId?: string;
  /** 1 makes it a single choice: picking someone replaces the last pick and closes the list. */
  max?: number;
  placeholder: string;
  invalid?: boolean;
};

const nameOf = (p: PickerPerson, meId?: string) => (p.id === meId ? `${p.full_name} (me)` : p.full_name);

/** A searchable list for choosing one person or several. Picked people show as chips that can be removed. */
export function PeoplePicker({ id, people, value, onChange, meId, max = 200, placeholder, invalid }: Props) {
  const single = max === 1;
  const picked = value.map((v) => people.find((p) => p.id === v)).filter((p): p is PickerPerson => !!p);
  const full = picked.length >= max;
  const labelOf = (personId: string) => {
    const p = people.find((x) => x.id === personId);
    return p ? nameOf(p, meId) : personId;
  };

  const field = (
    <>
      <div className="flex items-center gap-1">
        <ComboboxInput id={id} aria-invalid={invalid} placeholder={picked.length === 0 ? placeholder : "Search by name"} className="min-w-0 flex-1" />
        {single && (
          <ComboboxClear aria-label="Clear selection">
            <XIcon aria-hidden="true" className="size-3" />
          </ComboboxClear>
        )}
        <ComboboxTrigger aria-label="Show people">
          <ChevronsUpDownIcon aria-hidden="true" />
        </ComboboxTrigger>
      </div>
      <ComboboxContent>
        <ComboboxEmpty>Nobody matches.</ComboboxEmpty>
        <ComboboxList>
          {people.map((p) => (
            <ComboboxItem key={p.id} value={p.id} label={nameOf(p, meId)}>
              {nameOf(p, meId)}
              <ComboboxItemIndicator>
                <CheckIcon aria-hidden="true" />
              </ComboboxItemIndicator>
            </ComboboxItem>
          ))}
        </ComboboxList>
        {!single && full && <p data-slot="hint">That is the most you can pick ({max}).</p>}
      </ComboboxContent>
    </>
  );

  return (
    <div className="grid gap-2">
      {single ? (
        <Combobox value={value[0] ?? null} onValueChange={(next) => onChange(next ? [next as string] : [])} itemToLabel={labelOf}>
          {field}
        </Combobox>
      ) : (
        <Combobox multiple maxSelected={max} value={value} onValueChange={(next) => onChange(next as string[])} itemToLabel={labelOf}>
          {field}
        </Combobox>
      )}

      {!single && picked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen people">
          {picked.map((p) => (
            <li key={p.id} className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
              {nameOf(p, meId)}
              <Button
                type="button"
                aria-label={`Remove ${p.full_name}`}
                className="flex size-5 items-center justify-center rounded-full p-0"
                onClick={() => onChange(value.filter((x) => x !== p.id))}
              >
                <XIcon aria-hidden="true" className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
