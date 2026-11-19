import type { Area, Me } from "@/lib/permissions";
import { canAccess } from "@/lib/permissions";

export type NavGroup = "Me" | "Workspace" | "Departments" | "Admin";
export type NavItem = { area: Area; href: string; label: string; group: NavGroup; icon: string; phase: number };

// Order = sidebar order. `icon` names a lucide icon resolved in components/app-sidebar.tsx.
// `phase` = docs/BUILD_PLAN.md phase that delivers the screen (placeholders show it).
export const NAV: readonly NavItem[] = [
  { area: "me", href: "/me", label: "My space", group: "Me", icon: "user", phase: 5 },
  { area: "my_work", href: "/", label: "My day", group: "Workspace", icon: "inbox", phase: 0 },
  { area: "calendar", href: "/calendar", label: "Calendar", group: "Workspace", icon: "calendar-check", phase: 1 },
  { area: "institutions", href: "/institutions", label: "Institutions", group: "Workspace", icon: "building", phase: 1 },
  { area: "tasks", href: "/tasks", label: "Tasks", group: "Workspace", icon: "check", phase: 1 },
  { area: "timesheet", href: "/timesheet", label: "Timesheet", group: "Workspace", icon: "clock", phase: 1 },
  { area: "attendance", href: "/attendance", label: "Attendance", group: "Workspace", icon: "map-pin", phase: 1 },
  { area: "workload", href: "/workload", label: "Team workload", group: "Workspace", icon: "users", phase: 1 },
  { area: "feedback", href: "/feedback", label: "Feedback", group: "Workspace", icon: "message", phase: 2 },
  { area: "outreach", href: "/outreach", label: "Outreach", group: "Departments", icon: "megaphone", phase: 1 },
  { area: "sales", href: "/sales", label: "Sales", group: "Departments", icon: "handshake", phase: 1 },
  { area: "workshop", href: "/workshop", label: "Workshop", group: "Departments", icon: "calendar", phase: 1 },
  { area: "inventory", href: "/inventory", label: "Inventory", group: "Departments", icon: "package", phase: 1 },
  { area: "training", href: "/training", label: "Training", group: "Departments", icon: "graduation", phase: 3 },
  { area: "product", href: "/product", label: "Product", group: "Departments", icon: "chart", phase: 2 },
  { area: "community", href: "/community", label: "Community", group: "Departments", icon: "users", phase: 3 },
  { area: "hr", href: "/hr", label: "People & HR", group: "Admin", icon: "users", phase: 5 },
  { area: "cockpit", href: "/cockpit", label: "Cockpit", group: "Admin", icon: "gauge", phase: 4 },
  { area: "team", href: "/team", label: "Team", group: "Admin", icon: "shield", phase: 0 },
  { area: "audit_log", href: "/audit-log", label: "Audit log", group: "Admin", icon: "history", phase: 4 },
];

// Partners see their own records; label the shared areas accordingly.
const PARTNER_LABELS: Partial<Record<Area, string>> = {
  institutions: "My institutions",
  outreach: "My activities",
  sales: "My deals",
};

export function navFor(me: Me): NavItem[] {
  return NAV.filter((item) => canAccess(me, item.area)).map((item) =>
    me.role === "partner" && PARTNER_LABELS[item.area] ? { ...item, label: PARTNER_LABELS[item.area]! } : item,
  );
}

export function navItem(area: Area): NavItem {
  const item = NAV.find((n) => n.area === area);
  if (!item) throw new Error(`Unknown area ${area}`);
  return item;
}
