import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/team")).toBe("/team");
    expect(safeNextPath("/institutions/1?tab=deals")).toBe("/institutions/1?tab=deals");
  });
  it("rejects external and protocol-relative targets", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
  it("does not loop back into auth pages", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/auth/callback?code=x")).toBe("/");
    expect(safeNextPath("/no-access")).toBe("/");
  });
});
