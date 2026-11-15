import { z } from "zod";
import { DEPARTMENTS, ROLES, roleNeedsDepartments } from "@/lib/permissions";

// Mirrors ops.check_access_shape / ops.invite_staff so the form can explain problems before the
// round trip; the database re-validates everything.
const accessShape = <T extends { role: (typeof ROLES)[number]; departments: (typeof DEPARTMENTS)[number][] }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.role === "partner" && v.departments.length > 0) {
    ctx.addIssue({ code: "custom", path: ["departments"], message: "Partners cannot belong to departments." });
  }
  if (roleNeedsDepartments(v.role) && v.departments.length === 0) {
    ctx.addIssue({ code: "custom", path: ["departments"], message: "Choose at least one department." });
  }
};

export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." })),
    full_name: z.string().trim().max(120, "Keep the name under 120 characters.").optional().or(z.literal("")),
    role: z.enum(ROLES, { message: "Choose a role." }),
    departments: z.array(z.enum(DEPARTMENTS)),
  })
  .superRefine(accessShape);
export type InviteInput = z.input<typeof inviteSchema>;

export const updateAccessSchema = z
  .object({
    staff_id: z.uuid(),
    role: z.enum(ROLES, { message: "Choose a role." }),
    departments: z.array(z.enum(DEPARTMENTS)),
    is_active: z.boolean(),
  })
  .superRefine(accessShape);
export type UpdateAccessInput = z.input<typeof updateAccessSchema>;

export const inviteIdSchema = z.object({ invite_id: z.uuid() });
