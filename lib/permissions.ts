// UI-side access model. Mirrors (never replaces) the RLS rules in supabase/migrations (0008/0010) and
// the matrix in docs/ACCESS_MODEL.md. Used by the sidebar, route guards and Server Actions so the
// UI hides what a user cannot use; the database still decides what they can read or write.
import { z } from "zod";
import { Constants, type Enums } from "@/lib/db.types";

export type Role = Enums<"app_role">;
export type Department = Enums<"department">;

export const ROLES = Constants.ops.Enums.app_role;
export const DEPARTMENTS = Constants.ops.Enums.department;

/** Shape returned by ops.me(); null when the caller has no active staff row. */
export const meSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  departments: z.array(z.enum(DEPARTMENTS)),
});
export type Me = z.infer<typeof meSchema>;

export const AREAS = [
  "my_work",
  "institutions",
  "tasks",
  "feedback",
  "outreach",
  "sales",
  "workshop",
  "inventory",
  "training",
  "product",
  "community",
  "cockpit",
  "team",
  "audit_log",
] as const;
export type Area = (typeof AREAS)[number];

const FOUNDER_ONLY: ReadonlySet<Area> = new Set(["cockpit", "team", "audit_log"]);
// Areas a partner may open: their own institutions, activities (Outreach) and deals (Sales).
const PARTNER_AREAS: ReadonlySet<Area> = new Set(["my_work", "institutions", "outreach", "sales"]);
// Areas every internal role sees regardless of department.
const SHARED_AREAS: ReadonlySet<Area> = new Set(["my_work", "institutions", "tasks", "feedback"]);
// Department that unlocks each workspace. Inventory belongs to the Workshop department.
const AREA_DEPARTMENT: Partial<Record<Area, Department>> = {
  outreach: "outreach",
  sales: "sales",
  workshop: "workshop",
  inventory: "workshop",
  training: "training",
  product: "product",
  community: "community",
};

export function isFounder(me: Me | null): boolean {
  return me?.role === "founder";
}

/** Can this user open the area at all (read)? */
export function canAccess(me: Me | null, area: Area): boolean {
  if (!me) return false;
  if (me.role === "founder") return true;
  if (FOUNDER_ONLY.has(area)) return false;
  if (me.role === "partner") return PARTNER_AREAS.has(area);
  if (SHARED_AREAS.has(area)) return true;
  const dept = AREA_DEPARTMENT[area];
  return dept !== undefined && me.departments.includes(dept);
}

/** Can this user create/edit records (in the areas they can access)? Viewers are read-only. */
export function canWrite(me: Me | null): boolean {
  return !!me && me.role !== "viewer";
}

/** Can this user delete records in a department workspace? Founder anywhere, dept_lead in their departments. */
export function canDelete(me: Me | null, dept: Department): boolean {
  if (!me) return false;
  if (me.role === "founder") return true;
  return me.role === "dept_lead" && me.departments.includes(dept);
}

// Department membership as RLS sees it (ops.in_dept): founder = every department, partner = none.
function inDept(me: Me | null, dept: Department): boolean {
  if (!me || me.role === "partner") return false;
  return me.role === "founder" || me.departments.includes(dept);
}

/** Institutions: create needs Outreach or Sales; a partner may create only rows they own (institution_ins). */
export function canCreateInstitution(me: Me | null): boolean {
  if (!me || !canWrite(me)) return false;
  return me.role === "partner" || inDept(me, "outreach") || inDept(me, "sales");
}

/** Institutions: update needs Outreach, Sales or Workshop, or owning the row (institution_upd). */
export function canEditInstitution(me: Me | null, ownerId: string | null): boolean {
  if (!me || !canWrite(me)) return false;
  return inDept(me, "outreach") || inDept(me, "sales") || inDept(me, "workshop") || (ownerId !== null && ownerId === me.id);
}

/** Archive/restore: founder or department lead who can also edit the row (guard_archive + institution_upd). */
export function canArchiveInstitution(me: Me | null, ownerId: string | null): boolean {
  if (!me || (me.role !== "founder" && me.role !== "dept_lead")) return false;
  return canEditInstitution(me, ownerId);
}

/** Correcting an institution's stage is founder-only; stage is otherwise moved by events (guard_institution_stage). */
export function canCorrectStage(me: Me | null): boolean {
  return isFounder(me);
}

/** Contacts: write needs Outreach or Sales, or owning the institution (contact_ins/upd/del). Workshop cannot. */
export function canManageContacts(me: Me | null, institutionOwnerId: string | null): boolean {
  if (!me || !canWrite(me)) return false;
  return inDept(me, "outreach") || inDept(me, "sales") || (institutionOwnerId !== null && institutionOwnerId === me.id);
}

/** CSV import: write access plus Outreach, Sales or partner (ops.import_institutions). */
export function canImportInstitutions(me: Me | null): boolean {
  return canCreateInstitution(me);
}

/** Can this user mark a deal Won? Founder only (D7; enforced by ops.deal_transition). */
export function canMarkDealWon(me: Me | null): boolean {
  return isFounder(me);
}

export const ROLE_LABELS: Record<Role, string> = {
  founder: "Founder",
  dept_lead: "Department lead",
  member: "Member",
  viewer: "Viewer",
  partner: "Partner",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  founder: "Everything, including team admin, money and marking deals won.",
  dept_lead: "Manages their departments' records, can delete and sees KPI snapshots.",
  member: "Creates and edits records in their departments.",
  viewer: "Read-only in their departments.",
  partner: "External distribution partner: sees only the institutions, activities and deals they own.",
};

export const DEPARTMENT_LABELS: Record<Department, string> = {
  outreach: "Outreach",
  sales: "Sales",
  workshop: "Workshop",
  training: "Training",
  product: "Product",
  community: "Community",
};

/** Roles that must have departments (founder = all; partner = none). Mirrors ops.check_access_shape. */
export function roleNeedsDepartments(role: Role): boolean {
  return role !== "founder" && role !== "partner";
}
