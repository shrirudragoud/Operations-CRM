import { describe, expect, it } from "vitest";
import { AREAS, canAccess, canDelete, canMarkDealWon, canWrite, type Area, type Me } from "./permissions";

const me = (role: Me["role"], departments: Me["departments"] = []): Me => ({
  id: "00000000-0000-4000-8000-000000000001",
  full_name: "Test",
  email: "t@example.in",
  role,
  departments,
});

const allowed = (m: Me | null) => AREAS.filter((a) => canAccess(m, a)).sort();

describe("canAccess", () => {
  it("denies everything without a staff row", () => {
    expect(allowed(null)).toEqual([]);
  });

  it("gives the founder every area", () => {
    expect(allowed(me("founder"))).toEqual([...AREAS].sort());
  });

  it("keeps cockpit, team and audit log founder-only", () => {
    for (const role of ["dept_lead", "member", "viewer", "partner"] as const) {
      const m = me(role, role === "partner" ? [] : ["outreach", "sales", "workshop", "training", "product", "community"]);
      for (const area of ["cockpit", "team", "audit_log"] as Area[]) {
        expect(canAccess(m, area), `${role} -> ${area}`).toBe(false);
      }
    }
  });

  it("gives a partner only their own-record areas", () => {
    expect(allowed(me("partner"))).toEqual(["institutions", "my_work", "outreach", "sales"]);
  });

  it("ignores departments on a partner (partners are never department members)", () => {
    expect(canAccess(me("partner", ["workshop"]), "workshop")).toBe(false);
    expect(canAccess(me("partner", ["workshop"]), "inventory")).toBe(false);
  });

  it("opens department workspaces by membership", () => {
    const sales = me("member", ["sales"]);
    expect(canAccess(sales, "sales")).toBe(true);
    expect(canAccess(sales, "outreach")).toBe(false);
    expect(canAccess(sales, "inventory")).toBe(false);
    expect(allowed(sales)).toEqual(["feedback", "institutions", "my_work", "sales", "tasks"]);
  });

  it("puts inventory under the workshop department", () => {
    expect(canAccess(me("member", ["workshop"]), "inventory")).toBe(true);
    expect(canAccess(me("dept_lead", ["training"]), "inventory")).toBe(false);
  });

  it("lets viewers open (read) their departments", () => {
    expect(canAccess(me("viewer", ["product"]), "product")).toBe(true);
    expect(canAccess(me("viewer", ["product"]), "community")).toBe(false);
  });
});

describe("write, delete and won", () => {
  it("treats viewers as read-only", () => {
    expect(canWrite(me("viewer", ["sales"]))).toBe(false);
    expect(canWrite(me("member", ["sales"]))).toBe(true);
    expect(canWrite(me("partner"))).toBe(true);
    expect(canWrite(null)).toBe(false);
  });

  it("allows delete for founder anywhere and dept leads in their departments", () => {
    expect(canDelete(me("founder"), "workshop")).toBe(true);
    expect(canDelete(me("dept_lead", ["workshop"]), "workshop")).toBe(true);
    expect(canDelete(me("dept_lead", ["workshop"]), "sales")).toBe(false);
    expect(canDelete(me("member", ["workshop"]), "workshop")).toBe(false);
    expect(canDelete(me("partner"), "sales")).toBe(false);
  });

  it("lets only the founder mark deals won", () => {
    expect(canMarkDealWon(me("founder"))).toBe(true);
    expect(canMarkDealWon(me("dept_lead", ["sales"]))).toBe(false);
    expect(canMarkDealWon(me("partner"))).toBe(false);
  });
});
