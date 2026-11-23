import { describe, expect, it } from "vitest";
import { checkAttachments, messageSchema, requireMessage, requestSchema, startOnboardingSchema, stateSchema, templateSchema } from "@/lib/schemas/hr-requests";

const ID = "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11";

describe("HR request forms", () => {
  it("needs a subject and keeps details optional", () => {
    expect(requestSchema.safeParse({ kind: "experience_letter", subject: " ", details: "" }).success).toBe(false);
    expect(requestSchema.safeParse({ kind: "experience_letter", subject: "Letter for visa", details: "" }).success).toBe(true);
    expect(requestSchema.safeParse({ kind: "bogus", subject: "x", details: "" }).success).toBe(false);
  });
  it("defaults internal, keep_copy and finish to false", () => {
    const m = messageSchema.parse({ request_id: ID, body: "Hello" });
    expect([m.internal, m.keep_copy, m.finish]).toEqual([false, false, false]);
    expect(messageSchema.parse({ request_id: ID }).body).toBe("");
    expect(messageSchema.safeParse({ request_id: ID, body: "x".repeat(2001) }).success).toBe(false);
  });
  it("needs words or a file", () => {
    expect(requireMessage("  ", 0)).toMatch(/Write a message/);
    expect(requireMessage("", 1)).toBeNull();
    expect(requireMessage("Hi", 0)).toBeNull();
  });
  it("checks the files chosen for a message", () => {
    const pdf = { name: "a.pdf", size: 1000, type: "application/pdf" };
    expect(checkAttachments([pdf])).toBeNull();
    expect(checkAttachments(Array.from({ length: 6 }, () => pdf))).toMatch(/at most 5/);
    expect(checkAttachments([{ ...pdf, size: 11 * 1024 * 1024 }])).toMatch(/a\.pdf: .*10 MB/);
    expect(checkAttachments([{ ...pdf, type: "application/zip" }])).toMatch(/PDF or an image/);
    expect(checkAttachments([{ ...pdf, size: 0 }])).toMatch(/empty/);
  });
  it("accepts only the four states", () => {
    expect(stateSchema.safeParse({ request_id: ID, state: "done" }).success).toBe(true);
    expect(stateSchema.safeParse({ request_id: ID, state: "closed" }).success).toBe(false);
  });
});

describe("onboarding forms", () => {
  it("needs a person, and the date may be empty (the database defaults it)", () => {
    expect(startOnboardingSchema.safeParse({ staff_id: "", kind: "joiner", date: "" }).success).toBe(false);
    expect(startOnboardingSchema.safeParse({ staff_id: ID, kind: "joiner", date: "" }).success).toBe(true);
    expect(startOnboardingSchema.safeParse({ staff_id: ID, kind: "leaver", date: "05-03-2027" }).success).toBe(false);
  });
  it("keeps a template step's offset to whole days within 60 either way", () => {
    const base = { kind: "joiner", title: "Laptop", detail: "", owner: "hr" } as const;
    expect(templateSchema.parse({ ...base, due_offset: "-3" }).due_offset).toBe(-3);
    expect(templateSchema.safeParse({ ...base, due_offset: "61" }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, due_offset: "1.5" }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, title: "", due_offset: "0" }).success).toBe(false);
  });
});
