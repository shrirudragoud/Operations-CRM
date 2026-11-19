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
  works_from_office: z.boolean().optional(),
  is_hr: z.boolean().optional(),
  attendance_mode: z.enum(["office", "remote"]).optional(),
});
export type Me = z.infer<typeof meSchema>;

export const AREAS = [
  "my_work",
  "calendar",
  "institutions",
  "tasks",
  "timesheet",
  "attendance",
  "workload",
  "reports",
  "feedback",
  "me",
  "hr",
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

const FOUNDER_ONLY: ReadonlySet<Area> = new Set(["team", "audit_log"]);
// Areas a partner may open: their own institutions, activities (Outreach) and deals (Sales).
const PARTNER_AREAS: ReadonlySet<Area> = new Set(["my_work", "institutions", "outreach", "sales"]);
// Areas every internal role sees regardless of department.
const SHARED_AREAS: ReadonlySet<Area> = new Set(["my_work", "calendar", "institutions", "tasks", "timesheet", "feedback", "me"]);
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

/** Founder or an HR person (ops.can_hr). Viewers and partners are never HR. */
export function isHr(me: Me | null): boolean {
  return !!me && me.role !== "viewer" && me.role !== "partner" && (me.role === "founder" || me.is_hr === true);
}

/** Can this user open the area at all (read)? */
export function canAccess(me: Me | null, area: Area): boolean {
  if (!me) return false;
  if (me.role === "founder") return true;
  if (FOUNDER_ONLY.has(area)) return false;
  if (me.role === "partner") return PARTNER_AREAS.has(area);
  // The Cockpit's Operations view shows a lead their own team; Fundraising and the background jobs stay founder-only (page level).
  if (area === "workload" || area === "cockpit") return me.role === "dept_lead";
  if (area === "hr") return isHr(me);
  // Reports: the founder, department leads and HR; each report is gated again by what it reads (lib/reports.ts#canRunReport).
  if (area === "reports") return me.role === "dept_lead" || isHr(me);
  if (area === "attendance") return me.role === "dept_lead" || me.works_from_office === true;
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

/** Outreach activities: Outreach writers, or a partner logging their own (activity_ins / activity_partner). */
export function canLogActivity(me: Me | null): boolean {
  if (!me || !canWrite(me)) return false;
  return me.role === "partner" || inDept(me, "outreach");
}

type TaskScope = {
  department: Department | null;
  assignee_id: string | null;
  /** The assignee's departments, when the page has them: a lead of the assignee manages a task with no department. */
  assignee_departments?: readonly Department[] | null;
};

function inTaskDepartment(me: Me, task: TaskScope): boolean {
  return task.department !== null && inDept(me, task.department);
}

// ops.leads_task_assignee: a department lead whose department the assignee is in (never their own task); the founder sees all.
function leadsTaskAssignee(me: Me, task: TaskScope): boolean {
  if (task.department !== null || task.assignee_id === null || task.assignee_id === me.id) return false;
  if (me.role !== "dept_lead") return false;
  return !!task.assignee_departments?.some((d) => me.departments.includes(d));
}

/** Tasks: write needs a department the task belongs to, or being its assignee (task_upd). A partner can only finish their own follow-ups. */
export function canUpdateTask(me: Me | null, task: TaskScope & { created_by?: string | null }): boolean {
  if (!me || !canWrite(me)) return false;
  if (task.created_by === me.id) return true;
  return me.role === "founder" || inTaskDepartment(me, task) || task.assignee_id === me.id || leadsTaskAssignee(me, task);
}

type TaskRef = TaskScope & {
  created_by: string | null;
  completed_by?: string | null;
};

/** Anyone internal who can write may create a task, in any department, for anyone internal (task_ins). A partner cannot. */
export function canCreateTask(me: Me | null): boolean {
  return !!me && canWrite(me) && me.role !== "partner";
}

/** The "manager" of a task as ops.task_guard sees it: founder, its creator, or a lead of its department. */
export function canManageTask(me: Me | null, task: TaskRef): boolean {
  if (!me || !canWrite(me)) return false;
  if (me.role === "founder" || task.created_by === me.id) return true;
  if (me.role !== "dept_lead") return false;
  return (task.department !== null && me.departments.includes(task.department)) || leadsTaskAssignee(me, task);
}

/** Change the details (title, description, department): managers only. Everyone else uses schedule/comment. */
export function canEditTaskDetails(me: Me | null, task: TaskRef): boolean {
  return canManageTask(me, task);
}

/** Due date, priority, estimate and status: whoever can update the task (task_upd). */
export function canScheduleTask(me: Me | null, task: TaskRef): boolean {
  if (!me || !canWrite(me)) return false;
  return inTaskDepartment(me, task) || task.assignee_id === me.id || task.created_by === me.id || me.role === "founder" || leadsTaskAssignee(me, task);
}

/** Hand the task to someone else: managers. Others may only claim an unassigned task or decline their own. */
export function canReassignTask(me: Me | null, task: TaskRef): boolean {
  return canManageTask(me, task);
}

export function canClaimTask(me: Me | null, task: TaskRef): boolean {
  return canScheduleTask(me, task) && task.assignee_id === null && me !== null && me.role !== "partner";
}

export function canDeclineTask(me: Me | null, task: TaskRef): boolean {
  return !!me && canWrite(me) && task.assignee_id === me.id && !canManageTask(me, task);
}

export function canAcceptTask(me: Me | null, task: TaskRef & { accepted_at: string | null }): boolean {
  return !!me && canWrite(me) && task.assignee_id === me.id && task.accepted_at === null;
}

/** Reopen a done or cancelled task: managers, or whoever finished it (ops.task_guard). */
export function canReopenTask(me: Me | null, task: TaskRef): boolean {
  if (!me || !canWrite(me)) return false;
  return canManageTask(me, task) || task.completed_by === me.id;
}

/** Add or remove another person as a watcher: the task's managers (ops.task_manager). Anyone may watch or unwatch themselves. */
export function canManageWatchers(me: Me | null, task: TaskRef): boolean {
  return canManageTask(me, task);
}

/** Fixed (recurring) tasks for a department: the founder, or a lead of that department (task_recurrence policies). */
export function canManageRecurrence(me: Me | null, dept: Department): boolean {
  if (!me) return false;
  return me.role === "founder" || (me.role === "dept_lead" && me.departments.includes(dept));
}

/** Does this person lead anything (so the Fixed tasks page is worth showing)? */
export function canSeeFixedTasks(me: Me | null): boolean {
  return !!me && (me.role === "founder" || me.role === "dept_lead");
}

const OPEN_DEAL = new Set(["meeting", "proposal", "negotiation"]);

/** Deals: create/edit needs Sales, or a partner's own deals (deal_ins / deal_upd). Viewers are read-only. */
export function canManageDeals(me: Me | null): boolean {
  if (!me || !canWrite(me)) return false;
  return me.role === "partner" || inDept(me, "sales");
}

/** Edit the details (value, probability, close date, lines): open deals; a Won deal is founder-only (ops.deal_guard); Lost must be reopened first. */
export function canEditDeal(me: Me | null, deal: { stage: string; owner_id: string }): boolean {
  if (!canManageDeals(me) || !me) return false;
  if (me.role === "partner" && deal.owner_id !== me.id) return false;
  if (deal.stage === "won") return isFounder(me);
  return OPEN_DEAL.has(deal.stage);
}

/** Move a deal between stages (Won is separate: canMarkDealWon). Nothing leaves Won. */
export function canMoveDeal(me: Me | null, deal: { stage: string; owner_id: string }): boolean {
  if (!canManageDeals(me) || !me) return false;
  if (me.role === "partner" && deal.owner_id !== me.id) return false;
  return deal.stage !== "won";
}

/** Archive/restore a finished deal: founder or Sales lead (guard_archive + deal_upd). */
export function canArchiveDeal(me: Me | null): boolean {
  if (!me || (me.role !== "founder" && me.role !== "dept_lead")) return false;
  return inDept(me, "sales") && canWrite(me);
}

/** Can this user mark a deal Won? Founder only (D7; enforced by ops.deal_transition). */
export function canMarkDealWon(me: Me | null): boolean {
  return isFounder(me);
}

/** Events: create/edit/schedule/run-sheet needs Workshop (event_ins/upd, run_sheet_item_upd, set_event_team). Sales, Training and Community only read. */
export function canManageEvents(me: Me | null): boolean {
  return !!me && canWrite(me) && inDept(me, "workshop");
}

/** Archive/restore a finished event: founder or Workshop lead (guard_archive + event_upd). */
export function canArchiveEvent(me: Me | null): boolean {
  if (!me || (me.role !== "founder" && me.role !== "dept_lead")) return false;
  return canManageEvents(me);
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

/** Track time (timer, manual entries) and write the daily log: internal people who can write (ops.can_track_time). */
export function canTrackTime(me: Me | null): boolean {
  return !!me && me.role !== "viewer" && me.role !== "partner";
}

/** Check in and out: a tagged internal person (ops.can_attend). Viewers can; partners cannot. */
/** Tracked people who check in from anywhere instead of an office network (staff.attendance_mode). */
export function isRemote(me: Me | null): boolean {
  return !!me && me.attendance_mode === "remote";
}

export function canCheckIn(me: Me | null): boolean {
  return !!me && me.role !== "partner" && me.works_from_office === true;
}

/** See everyone's attendance and decide requests: the founder, or a department lead (ops.leads_staff). */
export function canSeeTeamAttendance(me: Me | null): boolean {
  return !!me && (me.role === "founder" || me.role === "dept_lead");
}

// ---------------------------------------------------------------- calendar and meetings (0022)

type MeetingRef = {
  organizer_id: string;
  department: Department | null;
  status: string;
  host_id?: string | null;
  awaiting_id?: string | null;
  ends_at?: string;
};

/** Schedule or request a meeting, and set up a fixed one: any internal person, viewers included (meeting_ins). A partner cannot. */
export function canScheduleMeeting(me: Me | null): boolean {
  return !!me && me.role !== "partner";
}

/** The "manager" of a meeting as ops.meeting_manager sees it: its organizer, the founder, or a lead of its department. */
export function canManageMeeting(me: Me | null, m: MeetingRef): boolean {
  if (!me || me.role === "partner") return false;
  if (me.role === "founder" || m.organizer_id === me.id) return true;
  return me.role === "dept_lead" && m.department !== null && me.departments.includes(m.department);
}

/** Edit, move, cancel or invite: the managers, while the meeting is open (a cancelled or declined one is frozen). */
export function canEditMeeting(me: Me | null, m: MeetingRef): boolean {
  return canManageMeeting(me, m) && (m.status === "scheduled" || m.status === "requested");
}

/** Open a meeting to a whole department: the founder, or a lead of that department (ops.leads_department). */
export function canOpenToDepartment(me: Me | null, dept: Department | null): boolean {
  if (!me || !dept) return false;
  return me.role === "founder" || (me.role === "dept_lead" && me.departments.includes(dept));
}

/** Make a meeting visible to everyone: founder only. */
export function canOpenToCompany(me: Me | null): boolean {
  return isFounder(me);
}

/** Answer an invitation (Going, Maybe, Not going): the person invited, while the meeting is scheduled and not over. The organizer cannot decline. */
export function canRsvp(me: Me | null, m: MeetingRef, attendeeId: string, now: Date = new Date()): boolean {
  if (!me || me.role === "partner" || me.id !== attendeeId) return false;
  if (m.status !== "scheduled") return false;
  return !m.ends_at || new Date(m.ends_at) >= now;
}

/** Accept, decline or suggest another time: only the person the request waits on (ops.answer_meeting_request). */
export function canAnswerRequest(me: Me | null, m: MeetingRef): boolean {
  return !!me && m.status === "requested" && m.awaiting_id === me.id;
}

/** Fixed meetings: edit, pause or remove by the organizer or the founder (meeting_series_upd / del). */
export function canManageSeries(me: Me | null, s: { organizer_id: string }): boolean {
  return !!me && me.role !== "partner" && (me.role === "founder" || s.organizer_id === me.id);
}

/** Set up a fixed meeting for a whole team: the founder or a lead of that department (ops.meeting_series_guard). */
export function canSetUpTeamSeries(me: Me | null, dept: Department | null): boolean {
  return canOpenToDepartment(me, dept);
}
