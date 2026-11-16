import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatINR, formatRange, initials } from "./format";

describe("format", () => {
  it("formats INR with Indian grouping", () => {
    expect(formatINR(125000)).toBe("₹1,25,000.00");
    expect(formatINR("4999.5")).toBe("₹4,999.50");
    expect(formatINR(null)).toBe("-");
  });
  it("shows timestamps in IST", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in India
    expect(formatDate("2026-12-31T20:00:00Z")).toBe("1 Jan 2027");
    expect(formatDateTime("2026-11-16T04:30:00Z")).toMatch(/16 Nov 2026.*10:00/i);
  });
  it("keeps plain dates on the same day", () => {
    expect(formatDate("2026-11-16")).toBe("16 Nov 2026");
  });
  it("builds initials", () => {
    expect(initials("Shri Rudragoud")).toBe("SR");
    expect(initials("")).toBe("?");
  });

  it("formats an event range in India time", () => {
    expect(formatRange(null, null)).toBe("Date not set");
    expect(formatRange("2026-12-01T04:00:00Z", "2026-12-01T10:00:00Z")).toMatch(/9:30\s?am to 3:30\s?pm/i);
    expect(formatRange("2026-12-01T04:00:00Z", "2026-12-03T10:00:00Z")).toMatch(/1 Dec 2026.* to 3 Dec 2026/);
  });
});
