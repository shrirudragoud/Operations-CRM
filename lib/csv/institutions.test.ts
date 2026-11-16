import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS, MAX_IMPORT_ROWS, importResultSchema, importRowsSchema, institutionTemplateCsv, parseInstitutionCsv,
} from "./institutions";

describe("parseInstitutionCsv", () => {
  it("maps rows to the RPC shape, trimming cells and filling missing columns with empty strings", () => {
    const r = parseInstitutionCsv("name,kind,city\n  ZZ Test College , polytechnic ,Pune\n");
    expect(r).toEqual({
      ok: true,
      ignoredColumns: [],
      rows: [{ name: "ZZ Test College", kind: "polytechnic", city: "Pune", district: "", state: "", affiliation: "", source: "", notes: "", owner_email: "" }],
    });
  });

  it("is forgiving about header case, spaces and a byte-order mark", () => {
    const r = parseInstitutionCsv("﻿Name,KIND,Owner Email\nA,school,x@y.in");
    expect(r.ok && r.rows[0]).toMatchObject({ name: "A", kind: "school", owner_email: "x@y.in" });
  });

  it("normalises kinds typed the way people read them", () => {
    const r = parseInstitutionCsv("name,kind\nA,Engineering College\nB,engineering-college");
    expect(r.ok && r.rows.map((x) => x.kind)).toEqual(["engineering_college", "engineering_college"]);
  });

  it("keeps commas and line breaks inside quoted cells", () => {
    const r = parseInstitutionCsv('name,kind,notes\nA,school,"Met Mr. Rao, the principal\nCall back in May"');
    expect(r.ok && r.rows[0]?.notes).toBe("Met Mr. Rao, the principal\nCall back in May");
  });

  it("skips blank lines and reports unknown columns instead of failing", () => {
    const r = parseInstitutionCsv("name,kind,principal\nA,school,Rao\n\n,,\nB,other,Iyer\n");
    expect(r.ok && r.rows.map((x) => x.name)).toEqual(["A", "B"]);
    expect(r.ok && r.ignoredColumns).toEqual(["principal"]);
  });

  it("rejects an empty file, a missing required column and a header-only file", () => {
    expect(parseInstitutionCsv("")).toMatchObject({ ok: false });
    expect(parseInstitutionCsv("name,city\nA,Pune")).toMatchObject({ ok: false, error: expect.stringContaining('"kind"') });
    expect(parseInstitutionCsv("kind,city\nschool,Pune")).toMatchObject({ ok: false, error: expect.stringContaining('"name"') });
    expect(parseInstitutionCsv("name,kind\n")).toMatchObject({ ok: false, error: expect.stringContaining("no rows") });
  });

  it("refuses more rows than the database accepts", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `School ${i},school`).join("\n");
    expect(parseInstitutionCsv(`name,kind\n${body}`)).toMatchObject({ ok: false, error: expect.stringContaining("at most 2000") });
    const ok = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `School ${i},school`).join("\n");
    expect(parseInstitutionCsv(`name,kind\n${ok}`)).toMatchObject({ ok: true });
  });
});

describe("institutionTemplateCsv", () => {
  it("has every column and parses back cleanly", () => {
    const csv = institutionTemplateCsv();
    expect(csv.split(/\r?\n/)[0]).toBe(CSV_COLUMNS.join(","));
    const r = parseInstitutionCsv(csv);
    expect(r.ok && r.rows).toHaveLength(2);
    expect(r.ok && r.rows.every((row) => row.name.startsWith("Example"))).toBe(true);
  });
});

describe("importRowsSchema / importResultSchema", () => {
  const row = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""]));
  it("accepts well-formed rows and rejects empty or oversized lists", () => {
    expect(importRowsSchema.safeParse([row]).success).toBe(true);
    expect(importRowsSchema.safeParse([]).success).toBe(false);
    expect(importRowsSchema.safeParse(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => row)).success).toBe(false);
    expect(importRowsSchema.safeParse([{ ...row, name: 5 }]).success).toBe(false);
  });
  it("parses the RPC result", () => {
    const r = importResultSchema.parse({
      dry_run: true, total: 3, valid: 2, inserted: 0, errors: [{ row: 2, name: "A", message: "Already exists" }],
    });
    expect(r.errors[0]?.row).toBe(2);
  });
});
