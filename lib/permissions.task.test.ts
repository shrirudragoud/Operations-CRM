import { describe, expect, it } from "vitest";
import {
  canAcceptTask, canClaimTask, canCreateTask, canDeclineTask, canManageTask, canReassignTask, canReopenTask,
  canScheduleTask, type Me,
} from "./permissions";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const me = (role: Me["role"], departments: Me["departments"] = []): Me => ({ id: ME, full_name: "T", email: "t@example.in", role, departments });
const task = (over: Partial<{ department: Me["departments"][number] | null; assignee_departments: Me["departments"]; assignee_id: string | null; created_by: string | null; completed_by: string | null; accepted_at: string | null }> = {}) => ({
  department: "sales" as const, assignee_id: OTHER, created_by: OTHER, completed_by: null, accepted_at: null, ...over,
});

describe("task permissions (mirror ops.task_guard and task RLS)", () => {
  it("any internal writer creates tasks in any department; viewers and partners do not", () => {
    expect(canCreateTask(me("member", ["outreach"]))).toBe(true);
    expect(canCreateTask(me("founder"))).toBe(true);
    expect(canCreateTask(me("viewer", ["sales"]))).toBe(false);
    expect(canCreateTask(me("partner"))).toBe(false);
    expect(canCreateTask(null)).toBe(false);
  });
  it("a manager is the founder, the creator or a lead of the task's department", () => {
    expect(canManageTask(me("founder"), task())).toBe(true);
    expect(canManageTask(me("member"), task({ created_by: ME }))).toBe(true);
    expect(canManageTask(me("dept_lead", ["sales"]), task())).toBe(true);
    expect(canManageTask(me("dept_lead", ["workshop"]), task())).toBe(false);
    expect(canManageTask(me("member", ["sales"]), task())).toBe(false);
    expect(canManageTask(me("viewer", ["sales"]), task({ created_by: ME }))).toBe(false);
  });
  it("only managers reassign; an assignee can decline, anyone in the department can claim an unassigned task", () => {
    expect(canReassignTask(me("member", ["sales"]), task({ assignee_id: ME }))).toBe(false);
    expect(canReassignTask(me("dept_lead", ["sales"]), task())).toBe(true);
    expect(canDeclineTask(me("member", ["sales"]), task({ assignee_id: ME }))).toBe(true);
    expect(canDeclineTask(me("member", ["sales"]), task())).toBe(false);
    expect(canClaimTask(me("member", ["sales"]), task({ assignee_id: null }))).toBe(true);
    expect(canClaimTask(me("member", ["workshop"]), task({ assignee_id: null }))).toBe(false);
    expect(canClaimTask(me("member", ["sales"]), task())).toBe(false);
    expect(canClaimTask(me("partner"), task({ assignee_id: null }))).toBe(false);
  });
  it("only the assignee accepts, once", () => {
    expect(canAcceptTask(me("member", ["sales"]), task({ assignee_id: ME }))).toBe(true);
    expect(canAcceptTask(me("member", ["sales"]), task({ assignee_id: ME, accepted_at: "2026-01-01T00:00:00Z" }))).toBe(false);
    expect(canAcceptTask(me("founder"), task())).toBe(false);
  });
  it("schedule needs the department, the assignment or having created it", () => {
    expect(canScheduleTask(me("member", ["sales"]), task())).toBe(true);
    expect(canScheduleTask(me("member", ["workshop"]), task({ assignee_id: ME }))).toBe(true);
    expect(canScheduleTask(me("member", ["workshop"]), task({ created_by: ME }))).toBe(true);
    expect(canScheduleTask(me("member", ["workshop"]), task())).toBe(false);
    expect(canScheduleTask(me("viewer", ["sales"]), task({ assignee_id: ME }))).toBe(false);
  });
  it("reopen is for managers or whoever finished it", () => {
    expect(canReopenTask(me("member", ["sales"]), task({ assignee_id: ME }))).toBe(false);
    expect(canReopenTask(me("member", ["sales"]), task({ assignee_id: ME, completed_by: ME }))).toBe(true);
    expect(canReopenTask(me("founder"), task({ completed_by: OTHER }))).toBe(true);
  });
  it("a task with no department is managed by the lead of the assignee's team, never by an unrelated lead or the assignee", () => {
    const open = task({ department: null, assignee_departments: ["workshop"] });
    expect(canManageTask(me("dept_lead", ["workshop"]), open)).toBe(true);
    expect(canScheduleTask(me("dept_lead", ["workshop"]), open)).toBe(true);
    expect(canManageTask(me("dept_lead", ["sales"]), open)).toBe(false);
    expect(canManageTask(me("member", ["workshop"]), open)).toBe(false);
    expect(canManageTask(me("dept_lead", ["workshop"]), { ...open, assignee_id: ME })).toBe(false);
    expect(canManageTask(me("founder"), open)).toBe(true);
    expect(canManageTask(me("member"), { ...open, created_by: ME })).toBe(true);
  });
  it("a task with no department and no person is only for its creator and the founder", () => {
    const lone = task({ department: null, assignee_id: null });
    expect(canScheduleTask(me("member", ["sales"]), lone)).toBe(false);
    expect(canManageTask(me("dept_lead", ["sales"]), lone)).toBe(false);
    expect(canManageTask(me("member", ["sales"]), { ...lone, created_by: ME })).toBe(true);
  });
});
