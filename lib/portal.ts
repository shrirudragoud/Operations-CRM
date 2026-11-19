import type { Me } from "@/lib/permissions";
import { canCheckIn } from "@/lib/permissions";

export type PortalTab = { id: string; href: string; label: string };

/** A profile and the directory belong to the team: viewers and partners have neither (ops.is_employee). */
export function canHaveProfile(me: Me): boolean {
  return me.role !== "viewer" && me.role !== "partner";
}

// Order = tab order. A tab appears only once its screen exists (docs/PLAN_EMPLOYEE_PORTAL.md, section 4).
export function portalTabsFor(me: Me): PortalTab[] {
  const tabs: PortalTab[] = [{ id: "overview", href: "/me", label: "Overview" }];
  if (canCheckIn(me)) tabs.push({ id: "attendance", href: "/me/attendance", label: "Attendance" });
  if (canHaveProfile(me)) tabs.push({ id: "leave", href: "/me/leave", label: "Leave" });
  if (canHaveProfile(me)) tabs.push({ id: "profile", href: "/me/profile", label: "Profile" }, { id: "directory", href: "/me/directory", label: "Directory" });
  if (canHaveProfile(me)) tabs.push({ id: "documents", href: "/me/documents", label: "Documents" }, { id: "requests", href: "/me/requests", label: "Ask HR" });
  return tabs;
}

/** The tab a path belongs to: the longest matching href, so /me/attendance does not also light up Overview. */
export function activePortalTab(tabs: PortalTab[], pathname: string): string | null {
  const hit = [...tabs]
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.id ?? null;
}
