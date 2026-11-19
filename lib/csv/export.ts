// CSV for download (reports). Cells that a spreadsheet could read as a formula are neutralised, and the file starts
// with a UTF-8 byte-order mark so Excel opens Indian names and the rupee sign correctly.

export type CsvValue = string | number | null | undefined;

export const CSV_BOM = "\uFEFF";

// A text cell starting with = + - @ (after any spaces), a tab or a carriage return is run as a formula by Excel and Sheets.
const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

/** One cell. Numbers stay numbers; text that could run as a formula gets a leading quote; commas, quotes and line breaks are quoted. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole table as CSV text (no byte-order mark; the response adds it). Lines end with CRLF. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(CSV_BOM + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  });
}
