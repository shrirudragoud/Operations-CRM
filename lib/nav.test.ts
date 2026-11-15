import { describe, expect, it } from "vitest";
import { AREAS, type Me } from "./permissions";
import { NAV, navFor } from "./nav";

const me = (role: Me["role"], departments: Me["departments"] = []): Me => ({
  id: "00000000-0000-4000-8000-000000000001", full_name: "T", email: "t@x.in", role, departments,
});

describe("navFor", () => {
  it("has one entry per area with unique hrefs", () => {
    expect(NAV.map((n) => n.area).sort()).toEqual([...AREAS].sort());
    expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  });
  it("shows the founder everything", () => {
    expect(navFor(me("founder"))).toHaveLength(NAV.length);
  });
  it("relabels partner areas as their own records", () => {
    expect(navFor(me("partner")).map((n) => n.label)).toEqual(["My work", "My institutions", "My activities", "My deals"]);
  });
  it("shows a workshop member workshop + inventory but no admin", () => {
    const labels = navFor(me("member", ["workshop"])).map((n) => n.label);
    expect(labels).toContain("Inventory");
    expect(labels).not.toContain("Team");
    expect(labels).not.toContain("Sales");
  });
});
