import { describe, expect, it } from "vitest";
import { messageSchema, requestSchema, startOnboardingSchema, stateSchema, templateSchema } from "@/lib/schemas/hr-requests";

const ID = "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11";

describe("HR request forms", () => {
  it("needs a subject and keeps details optional", () => {
    expect(requestSchema.safeParse({ kind: "experience_letter", subject: " ", details: "" }).success).toBe(false);
    expect(requestSchema.safeParse({ kind: "experience_letter", subject: "Letter for visa", details: "" }).success).toBe(true);
    expect(requestSchema.safeParse({ kind: "bogus", subject: "x", details: "" }).success).toBe(false);
  });
  it("needs a message body, and internal defaults to false", () => {
    expect(messageSchema.safeParse({ request_id: ID, body: "  " }).success).toBe(false);
    expect(messageSchema.parse({ request_id: ID, body: "Hello" }).internal).toBe(false);
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
