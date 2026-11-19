import { z } from "zod";

// Mirrors the checks on ops.staff_profile (0031); the database stays the authority.
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "intern", "contract", "consultant"] as const;
export const EMPLOYMENT_LABELS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  full_time: "Full time",
  part_time: "Part time",
  intern: "Intern",
  contract: "Contract",
  consultant: "Consultant",
};

const PHONE = /^[0-9+() -]{7,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A form text box: blank becomes null, anything else is trimmed and checked. */
function optionalText(label: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .transform((v) => (v === "" ? null : v));
}

function optionalMatch(label: string, re: RegExp, message: string, max = 200) {
  return z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .refine((v) => v === "" || re.test(v), message)
    .transform((v) => (v === "" ? null : v));
}

function optionalDate(label: string) {
  return z
    .string()
    .trim()
    .refine((v) => v === "" || (DATE.test(v) && !Number.isNaN(Date.parse(v))), `${label} must be a date.`)
    .transform((v) => (v === "" ? null : v));
}

/** What a person may edit on their own record. */
export const personalProfileSchema = z
  .object({
    legal_name: optionalText("Legal name", 120),
    birth_date: optionalDate("Birth date"),
    personal_email: optionalMatch("Personal email", EMAIL, "Enter a valid email address."),
    personal_phone: optionalMatch("Personal phone", PHONE, "Use 7 to 20 digits, spaces, + or ( ) -."),
    address: optionalText("Address", 500),
    emergency_name: optionalText("Emergency contact name", 120),
    emergency_phone: optionalMatch("Emergency contact phone", PHONE, "Use 7 to 20 digits, spaces, + or ( ) -."),
    emergency_relation: optionalText("Relationship", 60),
    blood_group: z
      .string()
      .refine((v) => v === "" || (BLOOD_GROUPS as readonly string[]).includes(v), "Pick a blood group from the list.")
      .transform((v) => (v === "" ? null : v)),
    birthday_visible: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if ((v.emergency_name === null) !== (v.emergency_phone === null)) {
      ctx.addIssue({
        code: "custom",
        path: [v.emergency_name === null ? "emergency_name" : "emergency_phone"],
        message: "Give both the name and the phone of your emergency contact, or leave both blank.",
      });
    }
    if (v.birth_date) {
      const limit = new Date();
      limit.setDate(limit.getDate() - 14 * 365);
      if (v.birth_date < "1900-01-01" || new Date(v.birth_date) > limit) {
        ctx.addIssue({ code: "custom", path: ["birth_date"], message: "Check the birth date." });
      }
    }
  });
export type PersonalProfileInput = z.input<typeof personalProfileSchema>;
export type PersonalProfile = z.output<typeof personalProfileSchema>;

/** What HR sets on someone else's record. */
export const hrProfileSchema = z
  .object({
    staff_id: z.uuid(),
    employee_code: optionalMatch("Employee code", /^[A-Za-z0-9-]{1,20}$/, "Use letters, digits and dashes, up to 20 characters.", 20),
    designation: optionalText("Designation", 120),
    joined_on: optionalDate("Joined date"),
    employment_type: z
      .string()
      .refine((v) => v === "" || (EMPLOYMENT_TYPES as readonly string[]).includes(v), "Pick an employment type from the list.")
      .transform((v) => (v === "" ? null : (v as (typeof EMPLOYMENT_TYPES)[number]))),
    probation_end: optionalDate("Probation end"),
    manager_id: z
      .string()
      .refine((v) => v === "" || z.uuid().safeParse(v).success, "Pick a manager from the list.")
      .transform((v) => (v === "" ? null : v)),
  })
  .superRefine((v, ctx) => {
    if (v.joined_on && v.joined_on < "2000-01-01") {
      ctx.addIssue({ code: "custom", path: ["joined_on"], message: "The joined date can't be before 2000." });
    }
    if (v.probation_end && v.joined_on && v.probation_end < v.joined_on) {
      ctx.addIssue({ code: "custom", path: ["probation_end"], message: "Probation can't end before the joined date." });
    }
    if (v.manager_id && v.manager_id === v.staff_id) {
      ctx.addIssue({ code: "custom", path: ["manager_id"], message: "A person can't be their own manager." });
    }
  });
export type HrProfileInput = z.input<typeof hrProfileSchema>;
export type HrProfile = z.output<typeof hrProfileSchema>;

export const monthSchema = z.coerce.number().int().min(1).max(12);
