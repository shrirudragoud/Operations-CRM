import { describe, expect, it } from "vitest";
import { hrProfileSchema, personalProfileSchema } from "./profile";

const ID = "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11";
const blank = {
  legal_name: "", birth_date: "", personal_email: "", personal_phone: "", address: "",
  emergency_name: "", emergency_phone: "", emergency_relation: "", blood_group: "", birthday_visible: false,
};
const hrBlank = { staff_id: ID, employee_code: "", designation: "", joined_on: "", employment_type: "", probation_end: "", manager_id: "" };

describe("personalProfileSchema", () => {
  it("turns blank boxes into null", () => {
    const r = personalProfileSchema.parse(blank);
    expect(r).toMatchObject({ legal_name: null, birth_date: null, personal_email: null, blood_group: null, birthday_visible: false });
  });
  it("trims text", () => {
    expect(personalProfileSchema.parse({ ...blank, legal_name: "  Asha Rao  " }).legal_name).toBe("Asha Rao");
  });
  it("checks email and phone", () => {
    expect(personalProfileSchema.safeParse({ ...blank, personal_email: "nope" }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ ...blank, personal_phone: "abc" }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ ...blank, personal_phone: "+91 98765 43210" }).success).toBe(true);
  });
  it("needs a name and a phone for the emergency contact together", () => {
    expect(personalProfileSchema.safeParse({ ...blank, emergency_name: "Ravi" }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ ...blank, emergency_phone: "9876543210" }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ ...blank, emergency_name: "Ravi", emergency_phone: "9876543210" }).success).toBe(true);
  });
  it("accepts only real blood groups", () => {
    expect(personalProfileSchema.safeParse({ ...blank, blood_group: "O+" }).success).toBe(true);
    expect(personalProfileSchema.safeParse({ ...blank, blood_group: "Z+" }).success).toBe(false);
  });
  it("refuses a birth date in the future or a child's", () => {
    expect(personalProfileSchema.safeParse({ ...blank, birth_date: "1990-05-17" }).success).toBe(true);
    expect(personalProfileSchema.safeParse({ ...blank, birth_date: "2999-01-01" }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ ...blank, birth_date: "1850-01-01" }).success).toBe(false);
    expect(personalProfileSchema.safeParse({ ...blank, birth_date: "not a date" }).success).toBe(false);
  });
});

describe("hrProfileSchema", () => {
  it("turns blank boxes into null", () => {
    expect(hrProfileSchema.parse(hrBlank)).toMatchObject({ employee_code: null, designation: null, joined_on: null, employment_type: null, manager_id: null });
  });
  it("checks the employee code", () => {
    expect(hrProfileSchema.safeParse({ ...hrBlank, employee_code: "HC-014" }).success).toBe(true);
    expect(hrProfileSchema.safeParse({ ...hrBlank, employee_code: "bad code!" }).success).toBe(false);
  });
  it("checks the employment type", () => {
    expect(hrProfileSchema.safeParse({ ...hrBlank, employment_type: "intern" }).success).toBe(true);
    expect(hrProfileSchema.safeParse({ ...hrBlank, employment_type: "volunteer" }).success).toBe(false);
  });
  it("probation cannot end before the joined date", () => {
    expect(hrProfileSchema.safeParse({ ...hrBlank, joined_on: "2026-01-10", probation_end: "2026-01-09" }).success).toBe(false);
    expect(hrProfileSchema.safeParse({ ...hrBlank, joined_on: "2026-01-10", probation_end: "2026-07-10" }).success).toBe(true);
  });
  it("nobody manages themselves", () => {
    expect(hrProfileSchema.safeParse({ ...hrBlank, manager_id: ID }).success).toBe(false);
    expect(hrProfileSchema.safeParse({ ...hrBlank, manager_id: "1c9a0f0e-3f2a-4f55-9a3b-5a5e0e0b9a22" }).success).toBe(true);
  });
});
