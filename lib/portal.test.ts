import { describe, expect, it } from "vitest";
import { activePortalTab, portalTabsFor } from "@/lib/portal";
import type { Me } from "@/lib/permissions";

const me = (over: Partial<Me> = {}): Me => ({ id: "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11", full_name: "A B", email: "a@b.c", role: "member", departments: ["sales"], ...over });

describe("portal tabs", () => {
  it("everyone gets Overview, only tracked people get Attendance", () => {
    const ids = (m: Me) => portalTabsFor(m).map((t) => t.id);
    expect(ids(me())).not.toContain("attendance");
    expect(ids(me({ works_from_office: true }))).toContain("attendance");
    expect(ids(me())[0]).toBe("overview");
  });
  it("team members get Profile and Directory; viewers and partners do not", () => {
    const ids = (m: Me) => portalTabsFor(m).map((t) => t.id);
    expect(ids(me())).toEqual(expect.arrayContaining(["profile", "directory"]));
    expect(ids(me({ role: "dept_lead" }))).toEqual(expect.arrayContaining(["profile", "directory"]));
    expect(ids(me())).toContain("leave");
    expect(ids(me({ role: "viewer" }))).not.toContain("leave");
    expect(ids(me({ role: "viewer" }))).toEqual(["overview"]);
    expect(ids(me({ role: "partner", departments: [] }))).toEqual(["overview"]);
  });
  it("team members get Documents and Ask HR; viewers and partners do not", () => {
    const ids = (m: Me) => portalTabsFor(m).map((t) => t.id);
    expect(ids(me())).toEqual(expect.arrayContaining(["documents", "requests"]));
    expect(ids(me({ role: "viewer" }))).not.toContain("documents");
    expect(ids(me({ role: "partner", departments: [] }))).not.toContain("requests");
  });
  it("the longest matching path wins, so Overview does not light up on /me/attendance", () => {
    const tabs = portalTabsFor(me({ works_from_office: true }));
    expect(activePortalTab(tabs, "/me")).toBe("overview");
    expect(activePortalTab(tabs, "/me/attendance")).toBe("attendance");
    expect(activePortalTab(tabs, "/me/attendance/statement")).toBe("attendance");
    expect(activePortalTab(tabs, "/me/profile")).toBe("profile");
    expect(activePortalTab(tabs, "/me/directory")).toBe("directory");
    expect(activePortalTab(tabs, "/elsewhere")).toBeNull();
  });
});
