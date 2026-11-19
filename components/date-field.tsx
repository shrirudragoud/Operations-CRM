"use client";

import { useState } from "react";
import { enIN } from "date-fns/locale";
import { CalendarIcon, ClockIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayIST } from "@/lib/format";

// India-style date and time inputs. The form value stays yyyy-mm-dd and HH:MM (what the database wants);
// only what the person sees changes: "17 Nov 2026" and "9:30 am", never the browser's mm/dd/yyyy.

const ymd = /^\d{4}-\d{2}-\d{2}$/;

function toDate(v: string): Date | undefined {
  if (!ymd.test(v)) return undefined;
  const [y = 0, m = 1, d = 1] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fromDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(v: string, n: number): string {
  const d = toDate(v) ?? new Date();
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

/** "17/11/2026", "17-11-26" or "17.11.2026" -> yyyy-mm-dd, or null when it is not a real day. */
export function parseIndianDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return fromDate(d);
}

/** "17 Nov 2026" */
export function showDate(v: string): string {
  const d = toDate(v);
  return d ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(d) : "";
}

type DateProps = {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  /** Earliest and latest pickable day (yyyy-mm-dd). */
  min?: string;
  max?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  clearable?: boolean;
  /** Show Today / Tomorrow / Next Monday shortcuts (only the ones inside min and max). */
  shortcuts?: boolean;
  className?: string;
};

export function DateField({ id, value, onChange, min, max, disabled, invalid, placeholder = "Pick a date", clearable = true, shortcuts = true, className }: DateProps) {
  const [open, setOpen] = useState(false);
  const v = value ?? "";
  const selected = toDate(v);
  const today = todayIST();
  const nextMonday = addDays(today, ((8 - (toDate(today)?.getDay() ?? 1)) % 7) || 7);
  const fits = (d: string) => (!min || d >= min) && (!max || d <= max);
  const quick = shortcuts
    ? ([["Today", today], ["Tomorrow", addDays(today, 1)], ["Next Monday", nextMonday]] as const).filter(([, d]) => fits(d))
    : [];

  const [typed, setTyped] = useState("");
  const [typedBad, setTypedBad] = useState(false);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setTyped("");
    setTypedBad(false);
  }

  function pickTyped() {
    const d = typed.trim() ? parseIndianDate(typed) : null;
    if (d && fits(d)) pick(d);
    else setTypedBad(true);
  }

  const minDate = min ? toDate(min) : undefined;
  const maxDate = max ? toDate(max) : undefined;
  const base = toDate(today) ?? new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn("w-full justify-start gap-2 font-normal", !v && "text-muted-foreground", clearable && v && !disabled && "pr-9")}
          >
            <CalendarIcon aria-hidden className="text-muted-foreground size-4" />
            <span className="truncate">{v ? showDate(v) : placeholder}</span>
          </Button>
        </PopoverTrigger>
        {clearable && v && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b p-2">
            {quick.map(([label, d]) => (
              <Button key={label} type="button" size="xs" variant={v === d ? "default" : "outline"} onClick={() => pick(d)}>{label}</Button>
            ))}
          </div>
        )}
        <div className="border-b p-2">
          <Input
            aria-label="Type a date (dd/mm/yyyy)"
            placeholder="dd/mm/yyyy"
            inputMode="numeric"
            autoComplete="off"
            className="h-8"
            value={typed}
            aria-invalid={typedBad || undefined}
            onChange={(e) => { setTyped(e.target.value); setTypedBad(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                pickTyped();
              }
            }}
          />
          {typedBad && <p role="alert" className="text-destructive mt-1 text-xs">Use dd/mm/yyyy{min || max ? ", inside the allowed days" : ""}.</p>}
        </div>
        <Calendar
          mode="single"
          locale={enIN}
          captionLayout="dropdown"
          startMonth={minDate ?? new Date(base.getFullYear() - 3, 0)}
          endMonth={maxDate ?? new Date(base.getFullYear() + 5, 11)}
          defaultMonth={selected ?? (maxDate && maxDate < base ? maxDate : base)}
          selected={selected}
          onSelect={(d) => d && pick(fromDate(d))}
          disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
        />
      </PopoverContent>
    </Popover>
  );
}

const NONE = "__none__";

function label12(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = Number(h);
  return `${hour % 12 || 12}:${m} ${hour < 12 ? "am" : "pm"}`;
}

const SLOTS: string[] = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

type TimeProps = {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
};

/** A 12-hour time in 15-minute steps, stored as HH:MM. */
export function TimeField({ id, value, onChange, disabled, invalid, placeholder = "Any time", clearable = true, className }: TimeProps) {
  const v = (value ?? "").slice(0, 5);
  const slots = v && !SLOTS.includes(v) ? [...SLOTS, v].sort() : SLOTS;
  return (
    <Select value={v || NONE} onValueChange={(x) => onChange(x === NONE ? "" : x)} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("w-full", className)}>
        <ClockIcon aria-hidden className="text-muted-foreground size-4" />
        <SelectValue placeholder={placeholder}>{v ? label12(v) : placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {clearable && <SelectItem value={NONE}>{placeholder}</SelectItem>}
        {slots.map((s) => <SelectItem key={s} value={s}>{label12(s)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
