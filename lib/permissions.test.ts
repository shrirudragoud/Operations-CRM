import { describe, expect, it } from "vitest";
import { AREAS, canAccess, canCheckIn, canSeeTeamAttendance,canAnswerRequest, canDelete, canEditMeeting, isRemote, canManageMeeting, canManageSeries, canOpenToCompany, canOpenToDepartment, canRsvp, canScheduleMeeting, canSetUpTeamSeries, canMarkDealWon, canTrackTime, canWrite, type Area, type Me } from "./permissions";

const me = (role: Me["role"], departments: Me["departments"] = []): Me => ({
  id: "00000000-0000-4000-8000-000000000001",
  full_name: "Test",
  email: "t@example.in",
  role,
  departments,
});

const allowed = (m: Me | null) => AREAS.filter((a) => canAccess(m, a)).sort();

describe("canAccess", () => {
  it("denies everything without a staff row", () => {
    expect(allowed(null)).toEqual([]);
  });

  it("gives the founder every area", () => {
    expect(allowed(me("founder"))).toEqual([...AREAS].sort());
  });

  it("keeps team and audit log founder-only", () => {
    for (const role of ["dept_lead", "member", "viewer", "partner"] as const) {
      const m = me(role, role === "partner" ? [] : ["outreach", "sales", "workshop", "training", "product", "community"]);
      for (const area of ["team", "audit_log"] as Area[]) {
        expect(canAccess(m, area), `${role} -> ${area}`).toBe(false);
      }
    }
  });

  it("opens the cockpit to the founder and to department leads only (leads see their own team)", () => {
    const depts: Me["departments"] = ["sales"];
    expect(canAccess(me("dept_lead", depts), "cockpit")).toBe(true);
    for (const role of ["member", "viewer", "partner"] as const) expect(canAccess(me(role, depts), "cockpit"), role).toBe(false);
  });

  it("gives a partner only their own-record areas", () => {
    expect(allowed(me("partner"))).toEqual(["institutions", "my_work", "outreach", "sales"]);
  });

  it("ignores departments on a partner (partners are never department members)", () => {
    expect(canAccess(me("partner", ["workshop"]), "workshop")).toBe(false);
    expect(canAccess(me("partner", ["workshop"]), "inventory")).toBe(false);
  });

  it("opens department workspaces by membership", () => {
    const sales = me("member", ["sales"]);
    expect(canAccess(sales, "sales")).toBe(true);
    expect(canAccess(sales, "outreach")).toBe(false);
    expect(canAccess(sales, "inventory")).toBe(false);
    expect(allowed(sales)).toEqual(["calendar", "feedback", "institutions", "me", "my_work", "sales", "tasks", "timesheet"]);
  });

  it("puts inventory under the workshop department", () => {
    expect(canAccess(me("member", ["workshop"]), "inventory")).toBe(true);
    expect(canAccess(me("dept_lead", ["training"]), "inventory")).toBe(false);
  });

  it("lets viewers open (read) their departments", () => {
    expect(canAccess(me("viewer", ["product"]), "product")).toBe(true);
    expect(canAccess(me("viewer", ["product"]), "community")).toBe(false);
  });
});

describe("write, delete and won", () => {
  it("treats viewers as read-only", () => {
    expect(canWrite(me("viewer", ["sales"]))).toBe(false);
    expect(canWrite(me("member", ["sales"]))).toBe(true);
    expect(canWrite(me("partner"))).toBe(true);
    expect(canWrite(null)).toBe(false);
  });

  it("allows delete for founder anywhere and dept leads in their departments", () => {
    expect(canDelete(me("founder"), "workshop")).toBe(true);
    expect(canDelete(me("dept_lead", ["workshop"]), "workshop")).toBe(true);
    expect(canDelete(me("dept_lead", ["workshop"]), "sales")).toBe(false);
    expect(canDelete(me("member", ["workshop"]), "workshop")).toBe(false);
    expect(canDelete(me("partner"), "sales")).toBe(false);
  });

  it("lets only the founder mark deals won", () => {
    expect(canMarkDealWon(me("founder"))).toBe(true);
    expect(canMarkDealWon(me("dept_lead", ["sales"]))).toBe(false);
    expect(canMarkDealWon(me("partner"))).toBe(false);
  });

  it("shows team workload to leads and the founder only, and the timesheet to every internal role", () => {
    expect(canAccess(me("founder"), "workload")).toBe(true);
    expect(canAccess(me("dept_lead", ["sales"]), "workload")).toBe(true);
    for (const role of ["member", "viewer", "partner"] as const) expect(canAccess(me(role, ["sales"]), "workload")).toBe(false);
    expect(canAccess(me("member", ["sales"]), "timesheet")).toBe(true);
    expect(canAccess(me("partner"), "timesheet")).toBe(false);
  });

  it("shows attendance to the founder, leads and tagged internal people", () => {
    const tagged = (role: Me["role"]): Me => ({ ...me(role, role === "partner" ? [] : ["sales"]), works_from_office: true });
    expect(canAccess(me("founder"), "attendance")).toBe(true);
    expect(canAccess(me("dept_lead", ["sales"]), "attendance")).toBe(true);
    expect(canAccess(me("member", ["sales"]), "attendance")).toBe(false);
    expect(canAccess(tagged("member"), "attendance")).toBe(true);
    expect(canAccess(tagged("viewer"), "attendance")).toBe(true);
    expect(canAccess(tagged("partner"), "attendance")).toBe(false);
  });

  it("lets tagged internal people check in, leads see the team", () => {
    const tagged = (role: Me["role"]): Me => ({ ...me(role, ["sales"]), works_from_office: true });
    expect(canCheckIn(tagged("member"))).toBe(true);
    expect(canCheckIn(tagged("viewer"))).toBe(true);
    expect(canCheckIn(tagged("partner"))).toBe(false);
    expect(canCheckIn(me("member", ["sales"]))).toBe(false);
    expect(canSeeTeamAttendance(me("dept_lead", ["sales"]))).toBe(true);
    expect(canSeeTeamAttendance(me("founder"))).toBe(true);
    expect(canSeeTeamAttendance(tagged("member"))).toBe(false);
  });

  it("lets internal people who can write track time, not viewers or partners", () => {
    expect(canTrackTime(me("member", ["sales"]))).toBe(true);
    expect(canTrackTime(me("dept_lead", ["sales"]))).toBe(true);
    expect(canTrackTime(me("viewer", ["sales"]))).toBe(false);
    expect(canTrackTime(me("partner"))).toBe(false);
    expect(canTrackTime(null)).toBe(false);
  });
});

describe("calendar and meetings", () => {
  const meeting = { organizer_id: "00000000-0000-4000-8000-0000000000aa", department: "workshop" as const, status: "scheduled", host_id: null, awaiting_id: null };
  const lead = me("dept_lead", ["workshop"]);
  it("opens the calendar to every internal role, not partners", () => {
    for (const role of ["founder", "dept_lead", "member", "viewer"] as const) expect(canAccess(me(role, ["sales"]), "calendar"), role).toBe(true);
    expect(canAccess(me("partner"), "calendar")).toBe(false);
  });
  it("lets viewers schedule but not partners", () => {
    expect(canScheduleMeeting(me("viewer", ["sales"]))).toBe(true);
    expect(canScheduleMeeting(me("partner"))).toBe(false);
  });
  it("manages a meeting as organizer, founder or lead of its department", () => {
    expect(canManageMeeting({ ...me("member", ["sales"]), id: meeting.organizer_id }, meeting)).toBe(true);
    expect(canManageMeeting(me("founder"), meeting)).toBe(true);
    expect(canManageMeeting(lead, meeting)).toBe(true);
    expect(canManageMeeting(me("dept_lead", ["sales"]), meeting)).toBe(false);
    expect(canManageMeeting(me("member", ["workshop"]), meeting)).toBe(false);
  });
  it("freezes cancelled and declined meetings", () => {
    expect(canEditMeeting(me("founder"), { ...meeting, status: "cancelled" })).toBe(false);
    expect(canEditMeeting(me("founder"), { ...meeting, status: "declined" })).toBe(false);
    expect(canEditMeeting(me("founder"), { ...meeting, status: "requested" })).toBe(true);
  });
  it("opens to a team only for the founder or that team's lead, to everyone only for the founder", () => {
    expect(canOpenToDepartment(lead, "workshop")).toBe(true);
    expect(canOpenToDepartment(lead, "sales")).toBe(false);
    expect(canOpenToDepartment(me("member", ["workshop"]), "workshop")).toBe(false);
    expect(canOpenToCompany(me("founder"))).toBe(true);
    expect(canOpenToCompany(lead)).toBe(false);
  });
  it("answers an invitation only for oneself, while scheduled and not over", () => {
    const me1 = me("member", ["sales"]);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(canRsvp(me1, { ...meeting, ends_at: future }, me1.id)).toBe(true);
    expect(canRsvp(me1, { ...meeting, ends_at: future }, "someone-else")).toBe(false);
    expect(canRsvp(me1, { ...meeting, ends_at: past }, me1.id)).toBe(false);
    expect(canRsvp(me1, { ...meeting, status: "requested", ends_at: future }, me1.id)).toBe(false);
  });
  it("answers a request only for the person it waits on", () => {
    const me1 = me("member", ["sales"]);
    expect(canAnswerRequest(me1, { ...meeting, status: "requested", awaiting_id: me1.id })).toBe(true);
    expect(canAnswerRequest(me1, { ...meeting, status: "requested", awaiting_id: "x" })).toBe(false);
    expect(canAnswerRequest(me1, { ...meeting, status: "scheduled", awaiting_id: me1.id })).toBe(false);
  });
  it("manages a fixed meeting as its organizer or the founder", () => {
    expect(canManageSeries(me("founder"), { organizer_id: "x" })).toBe(true);
    expect(canManageSeries(me("member", ["sales"]), { organizer_id: "x" })).toBe(false);
    expect(canManageSeries(me("member", ["sales"]), { organizer_id: me("member").id })).toBe(true);
    expect(canSetUpTeamSeries(lead, "workshop")).toBe(true);
    expect(canSetUpTeamSeries(me("member", ["workshop"]), "workshop")).toBe(false);
  });
});

describe("employee portal areas", () => {
  const base = { id: "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11", full_name: "A B", email: "a@b.c" };
  it("every internal role has a space of their own, partners do not", () => {
    for (const role of ["founder", "dept_lead", "member", "viewer"] as const) {
      expect(canAccess({ ...base, role, departments: ["sales"] }, "me")).toBe(true);
    }
    expect(canAccess({ ...base, role: "partner", departments: [] }, "me")).toBe(false);
  });
  it("HR area is for the founder and people flagged HR, never viewers or partners", () => {
    expect(canAccess({ ...base, role: "founder", departments: [] }, "hr")).toBe(true);
    expect(canAccess({ ...base, role: "member", departments: ["sales"], is_hr: true }, "hr")).toBe(true);
    expect(canAccess({ ...base, role: "dept_lead", departments: ["sales"] }, "hr")).toBe(false);
    expect(canAccess({ ...base, role: "viewer", departments: ["sales"], is_hr: true }, "hr")).toBe(false);
    expect(canAccess({ ...base, role: "partner", departments: [], is_hr: true }, "hr")).toBe(false);
  });
});

describe("isRemote", () => {
  const base = { id: "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11", full_name: "A B", email: "a@b.c", role: "member" as const, departments: ["sales" as const] };
  it("is true only when the mode is remote", () => {
    expect(isRemote({ ...base, attendance_mode: "remote" })).toBe(true);
    expect(isRemote({ ...base, attendance_mode: "office" })).toBe(false);
    expect(isRemote(base)).toBe(false);
    expect(isRemote(null)).toBe(false);
  });
});
