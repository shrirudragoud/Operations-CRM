import { describe, expect, it } from "vitest";
import {
  canArchiveInstitution, canCorrectStage, canCreateInstitution, canEditInstitution, canImportInstitutions,
  canManageContacts, type Me,
} from "./permissions";

const ME_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const me = (role: Me["role"], departments: Me["departments"] = []): Me => ({
  id: ME_ID, full_name: "Test", email: "t@example.in", role, departments,
});

describe("canCreateInstitution (institution_ins)", () => {
  it("allows founder, Outreach and Sales writers and partners", () => {
    expect(canCreateInstitution(me("founder"))).toBe(true);
    expect(canCreateInstitution(me("member", ["outreach"]))).toBe(true);
    expect(canCreateInstitution(me("dept_lead", ["sales"]))).toBe(true);
    expect(canCreateInstitution(me("partner"))).toBe(true);
  });
  it("refuses other departments, viewers and signed-out users", () => {
    expect(canCreateInstitution(me("member", ["workshop"]))).toBe(false);
    expect(canCreateInstitution(me("member", ["training", "product"]))).toBe(false);
    expect(canCreateInstitution(me("viewer", ["sales"]))).toBe(false);
    expect(canCreateInstitution(null)).toBe(false);
  });
});

describe("canEditInstitution (institution_upd)", () => {
  it("lets Outreach, Sales and Workshop writers edit any institution", () => {
    for (const dept of ["outreach", "sales", "workshop"] as const) {
      expect(canEditInstitution(me("member", [dept]), OTHER_ID), dept).toBe(true);
    }
  });
  it("lets an owner edit their own row but not someone else's", () => {
    expect(canEditInstitution(me("partner"), ME_ID)).toBe(true);
    expect(canEditInstitution(me("partner"), OTHER_ID)).toBe(false);
    expect(canEditInstitution(me("partner"), null)).toBe(false);
    expect(canEditInstitution(me("member", ["training"]), ME_ID)).toBe(true);
    expect(canEditInstitution(me("member", ["training"]), OTHER_ID)).toBe(false);
  });
  it("keeps viewers read-only even on their own row", () => {
    expect(canEditInstitution(me("viewer", ["sales"]), ME_ID)).toBe(false);
  });
});

describe("canArchiveInstitution (guard_archive)", () => {
  it("is limited to the founder and department leads", () => {
    expect(canArchiveInstitution(me("founder"), OTHER_ID)).toBe(true);
    expect(canArchiveInstitution(me("dept_lead", ["sales"]), OTHER_ID)).toBe(true);
    expect(canArchiveInstitution(me("member", ["sales"]), OTHER_ID)).toBe(false);
    expect(canArchiveInstitution(me("partner"), ME_ID)).toBe(false);
    expect(canArchiveInstitution(me("viewer", ["sales"]), OTHER_ID)).toBe(false);
    expect(canArchiveInstitution(null, null)).toBe(false);
  });
  it("still needs edit rights on the row", () => {
    expect(canArchiveInstitution(me("dept_lead", ["training"]), OTHER_ID)).toBe(false);
    expect(canArchiveInstitution(me("dept_lead", ["training"]), ME_ID)).toBe(true);
  });
});

describe("canCorrectStage", () => {
  it("is founder-only", () => {
    expect(canCorrectStage(me("founder"))).toBe(true);
    expect(canCorrectStage(me("dept_lead", ["sales"]))).toBe(false);
    expect(canCorrectStage(me("member", ["outreach"]))).toBe(false);
    expect(canCorrectStage(me("partner"))).toBe(false);
    expect(canCorrectStage(null)).toBe(false);
  });
});

describe("canManageContacts (contact_ins/upd/del)", () => {
  it("allows Outreach and Sales writers and the institution's owner", () => {
    expect(canManageContacts(me("member", ["outreach"]), OTHER_ID)).toBe(true);
    expect(canManageContacts(me("member", ["sales"]), null)).toBe(true);
    expect(canManageContacts(me("partner"), ME_ID)).toBe(true);
  });
  it("refuses Workshop (it may edit institutions but not contacts), other owners and viewers", () => {
    expect(canManageContacts(me("member", ["workshop"]), OTHER_ID)).toBe(false);
    expect(canManageContacts(me("partner"), OTHER_ID)).toBe(false);
    expect(canManageContacts(me("viewer", ["sales"]), ME_ID)).toBe(false);
  });
});

describe("canImportInstitutions (import_institutions)", () => {
  it("matches who can create institutions", () => {
    expect(canImportInstitutions(me("partner"))).toBe(true);
    expect(canImportInstitutions(me("member", ["sales"]))).toBe(true);
    expect(canImportInstitutions(me("member", ["workshop"]))).toBe(false);
    expect(canImportInstitutions(me("viewer", ["outreach"]))).toBe(false);
  });
});
