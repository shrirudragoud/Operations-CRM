import Papa from "papaparse";
import { z } from "zod";

// Browser-side CSV handling for the institution import. The database (ops.import_institutions)
// re-validates every row; this only turns a file into the row shape the RPC expects.

export const CSV_COLUMNS = [
  "name", "kind", "city", "district", "state", "affiliation", "source", "notes", "owner_email",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type ImportRow = Record<CsvColumn, string>;

/** Mirrors the limit enforced by ops.import_institutions. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CELL = 4000;

export type CsvParseResult =
  | { ok: true; rows: ImportRow[]; ignoredColumns: string[] }
  | { ok: false; error: string };

const normaliseHeader = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
/** "Engineering College" -> engineering_college, so people can type kinds the way they read them. */
const normaliseKind = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, "_");

export function parseInstitutionCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normaliseHeader,
  });

  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) return { ok: false, error: "The file is empty." };
  for (const required of ["name", "kind"] as const) {
    if (!headers.includes(required)) {
      return { ok: false, error: `The file needs a "${required}" column. Download the template to see the layout.` };
    }
  }
  // Papa reports per-row structural problems (e.g. a quote that never closes). Too-many/too-few
  // field counts are tolerated: missing cells become empty and the database checks required ones.
  const fatal = parsed.errors.find((e) => e.type === "Quotes");
  if (fatal) return { ok: false, error: `The file could not be read (row ${(fatal.row ?? 0) + 1}: ${fatal.message}).` };

  if (parsed.data.length === 0) return { ok: false, error: "The file has a header but no rows." };
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `The file has ${parsed.data.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.` };
  }

  const rows = parsed.data.map((raw): ImportRow => {
    const row = {} as ImportRow;
    for (const col of CSV_COLUMNS) row[col] = (raw[col] ?? "").toString().trim().slice(0, MAX_CELL);
    row.kind = normaliseKind(row.kind);
    return row;
  });
  const ignoredColumns = headers.filter((h) => h !== "" && !(CSV_COLUMNS as readonly string[]).includes(h));
  return { ok: true, rows, ignoredColumns };
}

/** A small file people can fill in. Two obviously fake example rows show the expected values. */
export function institutionTemplateCsv(): string {
  const examples: ImportRow[] = [
    {
      name: "Example Polytechnic", kind: "polytechnic", city: "Pune", district: "Pune", state: "Maharashtra",
      affiliation: "MSBTE", source: "referral", notes: "", owner_email: "",
    },
    {
      name: "Example High School", kind: "school", city: "Nashik", district: "Nashik", state: "Maharashtra",
      affiliation: "CBSE", source: "", notes: "Met the principal at an expo", owner_email: "",
    },
  ];
  return Papa.unparse({ fields: [...CSV_COLUMNS], data: examples.map((r) => CSV_COLUMNS.map((c) => r[c])) });
}

// Shape of the Server Action input and of ops.import_institutions' result.
export const importRowsSchema = z
  .array(z.object(Object.fromEntries(CSV_COLUMNS.map((c) => [c, z.string().max(MAX_CELL)])) as Record<CsvColumn, z.ZodString>))
  .min(1, "The file has no rows.")
  .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

export const importResultSchema = z.object({
  dry_run: z.boolean(),
  total: z.number(),
  valid: z.number(),
  inserted: z.number(),
  errors: z.array(z.object({ row: z.number(), name: z.string(), message: z.string() })),
});
export type ImportResult = z.infer<typeof importResultSchema>;
