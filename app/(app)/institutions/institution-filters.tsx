"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  INSTITUTION_KINDS, KIND_LABELS, STAGES, STAGE_LABELS, listQuery,
  type ArchivedMode, type InstitutionKind, type ListParams, type Stage,
} from "@/lib/schemas/institution";

const ALL = "all"; // Radix Select cannot use an empty string as a value.

export type OwnerOption = { id: string; full_name: string };

export function InstitutionFilters({
  params, owners, showOwnerFilter,
}: { params: ListParams; owners: OwnerOption[]; showOwnerFilter: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q);
  const [district, setDistrict] = useState(params.district);

  // Any change starts again from page 1 and keeps the current sort.
  function apply(next: Partial<ListParams>) {
    const qs = listQuery({ ...params, q, district, ...next, page: 1 });
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const hasFilters =
    !!params.q || !!params.district || !!params.stage || !!params.kind || !!params.owner || params.archived !== "hide";

  return (
    <form
      role="search"
      aria-label="Filter institutions"
      onSubmit={(e) => {
        e.preventDefault();
        apply({});
      }}
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7"
    >
      <Field className="lg:col-span-2">
        <FieldLabel htmlFor="inst-q">Search name or city</FieldLabel>
        <div className="relative">
          <SearchIcon aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input id="inst-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Pune" className="pl-9" maxLength={100} />
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="inst-stage">Stage</FieldLabel>
        <Select value={params.stage ?? ALL} onValueChange={(v) => apply({ stage: v === ALL ? null : (v as Stage) })}>
          <SelectTrigger id="inst-stage" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any stage</SelectItem>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="inst-kind">Kind</FieldLabel>
        <Select value={params.kind ?? ALL} onValueChange={(v) => apply({ kind: v === ALL ? null : (v as InstitutionKind) })}>
          <SelectTrigger id="inst-kind" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any kind</SelectItem>
            {INSTITUTION_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="inst-district">District</FieldLabel>
        <Input id="inst-district" value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={100} />
      </Field>
      {showOwnerFilter && (
        <Field>
          <FieldLabel htmlFor="inst-owner">Owner</FieldLabel>
          <Select value={params.owner ?? ALL} onValueChange={(v) => apply({ owner: v === ALL ? null : v })}>
            <SelectTrigger id="inst-owner" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="inst-archived">Archived</FieldLabel>
        <Select value={params.archived} onValueChange={(v) => apply({ archived: v as ArchivedMode })}>
          <SelectTrigger id="inst-archived" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hide">Hide archived</SelectItem>
            <SelectItem value="only">Only archived</SelectItem>
            <SelectItem value="all">Show all</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-7">
        <Button type="submit" disabled={pending}>{pending && <Spinner />} Search</Button>
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              setDistrict("");
              startTransition(() => router.push(pathname));
            }}
          >
            <XIcon aria-hidden /> Clear filters
          </Button>
        )}
      </div>
    </form>
  );
}
