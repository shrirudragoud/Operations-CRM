import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvResponse, toCsv } from "./export";

describe("csvCell", () => {
  it("quotes formula starters in text", () => {
    for (const s of ["=1+1", "+91 98765", "-2", "@SUM(A1)", "\t=cmd", "\r=x", "  =HYPERLINK(\"x\")"]) {
      expect(csvCell(s).replace(/^"/, "").startsWith("'"), s).toBe(true);
    }
  });
  it("leaves numbers numeric, including negatives", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(Number.NaN)).toBe("");
  });
  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("keeps ordinary text, including Indian names, untouched", () => {
    expect(csvCell("Shridhar Rudragoud")).toBe("Shridhar Rudragoud");
    expect(csvCell("शाळा")).toBe("शाळा");
  });
});

describe("toCsv", () => {
  it("writes a header line then rows, CRLF separated", () => {
    expect(toCsv(["A", "B"], [["x", 1], [null, "=2"]])).toBe("A,B\r\nx,1\r\n,'=2\r\n");
  });
});

describe("csvResponse", () => {
  it("adds the byte-order mark and download headers, and cleans the filename", async () => {
    const res = csvResponse("A\r\n", 'bad"name/..csv');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(`${CSV_BOM}A\r\n`);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="bad_name_..csv"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
