import { describe, expect, it } from "vitest";
import { parseIndianDate } from "@/components/date-field";

describe("parseIndianDate", () => {
  it("reads dd/mm/yyyy and common variants", () => {
    expect(parseIndianDate("17/11/2026")).toBe("2026-11-17");
    expect(parseIndianDate("5-3-26")).toBe("2026-03-05");
    expect(parseIndianDate(" 01.02.2027 ")).toBe("2027-02-01");
  });
  it("rejects impossible days and other shapes", () => {
    expect(parseIndianDate("31/02/2026")).toBeNull();
    expect(parseIndianDate("2026-11-17")).toBeNull();
    expect(parseIndianDate("11/17/2026")).toBeNull();
    expect(parseIndianDate("")).toBeNull();
  });
});
