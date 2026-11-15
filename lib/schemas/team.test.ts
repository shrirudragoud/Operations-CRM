import { describe, expect, it } from "vitest";
import { inviteSchema, updateAccessSchema } from "./team";

describe("inviteSchema", () => {
  it("normalises the email", () => {
    const r = inviteSchema.parse({ email: "  Asha@Example.IN ", role: "member", departments: ["sales"] });
    expect(r.email).toBe("asha@example.in");
  });
  it("requires departments for internal roles", () => {
    const r = inviteSchema.safeParse({ email: "a@b.in", role: "member", departments: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["departments"]);
  });
  it("forbids departments for partners and allows none for founders", () => {
    expect(inviteSchema.safeParse({ email: "a@b.in", role: "partner", departments: ["sales"] }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.in", role: "partner", departments: [] }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "a@b.in", role: "founder", departments: [] }).success).toBe(true);
  });
  it("rejects bad emails", () => {
    expect(inviteSchema.safeParse({ email: "nope", role: "viewer", departments: ["sales"] }).success).toBe(false);
  });
});

describe("updateAccessSchema", () => {
  it("validates the same access shape", () => {
    const base = { staff_id: "00000000-0000-4000-8000-000000000001", is_active: true };
    expect(updateAccessSchema.safeParse({ ...base, role: "viewer", departments: [] }).success).toBe(false);
    expect(updateAccessSchema.safeParse({ ...base, role: "viewer", departments: ["product"] }).success).toBe(true);
  });
});
