"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageBadge } from "@/components/stage-badge";
import { formatDate } from "@/lib/format";
import { KIND_LABELS, listQuery, type InstitutionKind, type ListParams, type SortColumn } from "@/lib/schemas/institution";
import type { InstitutionRow } from "@/lib/queries/institution";

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, InstitutionRow>();

function SortHeader({ column, label, params }: { column: SortColumn; label: string; params: ListParams }) {
  const active = params.sort === column;
  const next = active ? { sort: column, desc: !params.desc } : { sort: column, desc: false };
  const Icon = !active ? ArrowUpDownIcon : params.desc ? ArrowDownIcon : ArrowUpIcon;
  const qs = listQuery({ ...params, ...next, page: 1 });
  return (
    <Link
      href={qs ? `?${qs}` : "?"}
      className="hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1 rounded px-1 outline-none focus-visible:ring-[3px]"
      aria-label={`Sort by ${label}${active ? (params.desc ? ", currently descending" : ", currently ascending") : ""}`}
    >
      {label}
      <Icon aria-hidden className="size-3.5" />
    </Link>
  );
}

export function InstitutionTable({ rows, params }: { rows: InstitutionRow[]; params: ListParams }) {
  const { sort, desc } = params;
  const columns = useMemo(() => {
    const p = { ...params, sort, desc };
    return helper.columns([
      helper.accessor("name", {
        id: "name",
        header: () => <SortHeader column="name" label="Name" params={p} />,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/institutions/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                {row.name}
              </Link>
              {row.archived_at && <Badge variant="outline">Archived</Badge>}
            </div>
          );
        },
      }),
      helper.accessor("kind", {
        id: "kind",
        header: "Kind",
        cell: (info) => <span className="hidden sm:inline">{KIND_LABELS[info.getValue() as InstitutionKind]}</span>,
      }),
      helper.accessor("city", {
        id: "city",
        header: () => <SortHeader column="city" label="City" params={p} />,
        cell: (info) => {
          const row = info.row.original;
          const place = [info.getValue(), row.district].filter(Boolean).join(", ");
          return place || <span className="text-muted-foreground">-</span>;
        },
      }),
      helper.accessor("stage", {
        id: "stage",
        header: () => <SortHeader column="stage" label="Stage" params={p} />,
        cell: (info) => <StageBadge stage={info.getValue()} />,
      }),
      helper.accessor((r) => r.owner?.full_name ?? null, {
        id: "owner",
        header: "Owner",
        cell: (info) => info.getValue() ?? <span className="text-muted-foreground">Unassigned</span>,
      }),
      helper.accessor("updated_at", {
        id: "updated_at",
        header: () => <SortHeader column="updated_at" label="Updated" params={p} />,
        cell: (info) => <span className="whitespace-nowrap">{formatDate(info.getValue())}</span>,
      }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params is rebuilt from these fields
  }, [params.page, params.q, params.stage, params.kind, params.district, params.owner, params.archived, sort, desc]);

  const table = useTable({ features, columns, data: rows });

  return (
    <Table aria-label="Institutions">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={header.column.id === "kind" ? "hidden sm:table-cell" : header.column.id === "owner" || header.column.id === "updated_at" ? "hidden md:table-cell" : undefined}
                aria-sort={
                  params.sort === header.column.id ? (params.desc ? "descending" : "ascending") : undefined
                }
              >
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className={row.original.archived_at ? "text-muted-foreground" : undefined}>
            {row.getAllCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cell.column.id === "kind" ? "hidden sm:table-cell" : cell.column.id === "owner" || cell.column.id === "updated_at" ? "hidden md:table-cell" : undefined}
              >
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
