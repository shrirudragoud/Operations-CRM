import { describe, expect, it } from "vitest";
import {
  cleanSearch, contactSchema, correctStageSchema, institutionSchema, listQuery, parseListParams,
} from "./institution";

const UUID = "00000000-0000-4000-8000-000000000001";
const base = { name: "ZZ Test College", kind: "polytechnic", affiliation: "", city: "", district: "", state: "", source: "", notes: "", owner_id: "" };

describe("institutionSchema", () => {
  it("trims, and turns empty optional text and owner into null", () => {
    const r = institutionSchema.parse({ ...base, name: "  ZZ Test College  ", city: "  Pune ", state: "Maharashtra" });
    expect(r.name).toBe("ZZ Test College");
    expect(r.city).toBe("Pune");
    expect(r.district).toBeNull();
    expect(r.owner_id).toBeNull();
  });
  it("requires a name and a valid kind", () => {
    const noName = institutionSchema.safeParse({ ...base, name: "   " });
    expect(noName.success).toBe(false);
    expect(noName.error?.issues[0]?.path).toEqual(["name"]);
    expect(institutionSchema.safeParse({ ...base, kind: "college" }).success).toBe(false);
    expect(institutionSchema.safeParse({ ...base, kind: "" }).success).toBe(false);
  });
  it("caps the name at 200 characters", () => {
    expect(institutionSchema.safeParse({ ...base, name: "a".repeat(201) }).success).toBe(false);
    expect(institutionSchema.safeParse({ ...base, name: "a".repeat(200) }).success).toBe(true);
  });
  it("accepts an owner uuid and rejects anything else", () => {
    expect(institutionSchema.parse({ ...base, owner_id: UUID }).owner_id).toBe(UUID);
    expect(institutionSchema.safeParse({ ...base, owner_id: "not-a-uuid" }).success).toBe(false);
  });
  it("never lets the form set the stage", () => {
    const r = institutionSchema.parse({ ...base, stage: "active" });
    expect("stage" in r).toBe(false);
  });
});

describe("contactSchema", () => {
  const c = { full_name: "Asha Patil", designation: "", influence: "", phone: "", email: "" };
  it("accepts a name alone and nulls the empty fields", () => {
    const r = contactSchema.parse(c);
    expect(r).toEqual({ full_name: "Asha Patil", designation: null, influence: null, phone: null, email: null });
  });
  it("normalises the email and validates it", () => {
    expect(contactSchema.parse({ ...c, email: " Asha@College.EDU " }).email).toBe("asha@college.edu");
    expect(contactSchema.safeParse({ ...c, email: "nope" }).success).toBe(false);
  });
  it("validates the phone number and influence", () => {
    expect(contactSchema.safeParse({ ...c, phone: "+91 98765 43210" }).success).toBe(true);
    expect(contactSchema.safeParse({ ...c, phone: "call me" }).success).toBe(false);
    expect(contactSchema.parse({ ...c, influence: "decision_maker" }).influence).toBe("decision_maker");
    expect(contactSchema.safeParse({ ...c, influence: "boss" }).success).toBe(false);
  });
  it("requires a name", () => {
    expect(contactSchema.safeParse({ ...c, full_name: " " }).success).toBe(false);
  });
});

describe("correctStageSchema", () => {
  it("accepts only lifecycle stages", () => {
    expect(correctStageSchema.safeParse({ id: UUID, stage: "workshop_delivered" }).success).toBe(true);
    expect(correctStageSchema.safeParse({ id: UUID, stage: "won" }).success).toBe(false);
  });
});

describe("parseListParams", () => {
  it("falls back to safe defaults for empty or hostile input", () => {
    const p = parseListParams({ page: "-3", stage: "nope", kind: "x", owner: "'; drop", archived: "yes", sort: "password" });
    expect(p).toMatchObject({ page: 1, stage: null, kind: null, owner: null, archived: "hide", sort: "name", desc: false });
  });
  it("reads valid values, including descending sort and the unassigned owner", () => {
    const p = parseListParams({ page: "3", q: "Pune", stage: "qualified", kind: "school", owner: "none", archived: "only", sort: "-updated_at" });
    expect(p).toMatchObject({ page: 3, q: "Pune", stage: "qualified", kind: "school", owner: "none", archived: "only", sort: "updated_at", desc: true });
    expect(parseListParams({ owner: UUID }).owner).toBe(UUID);
  });
  it("takes the first value of a repeated parameter and caps the page", () => {
    expect(parseListParams({ q: ["a", "b"] }).q).toBe("a");
    expect(parseListParams({ page: "99999999" }).page).toBe(10_000);
  });
});

describe("cleanSearch", () => {
  it("removes characters that would break an ilike pattern or a PostgREST or() filter", () => {
    expect(cleanSearch('a%b_c,(d)*"e\\f')).toBe("a b c d e f");
    expect(cleanSearch("   spaced    out  ")).toBe("spaced out");
    expect(cleanSearch("x".repeat(300))).toHaveLength(100);
  });
});

describe("listQuery", () => {
  it("omits defaults and round-trips through parseListParams", () => {
    expect(listQuery({})).toBe("");
    const params = { page: 2, q: "Pune", stage: "qualified" as const, archived: "all" as const, sort: "city" as const, desc: true };
    const qs = listQuery(params);
    const parsed = parseListParams(Object.fromEntries(new URLSearchParams(qs)));
    expect(parsed).toMatchObject(params);
  });
});
