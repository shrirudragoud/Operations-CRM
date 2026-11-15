"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BuildingIcon, CalendarDaysIcon, ChartLineIcon, CheckSquareIcon, GaugeIcon, GraduationCapIcon,
  HandshakeIcon, HistoryIcon, InboxIcon, MegaphoneIcon, MessageSquareIcon, PackageIcon, ShieldIcon,
  UsersIcon, type LucideIcon,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import type { NavGroup, NavItem } from "@/lib/nav";
import { ROLE_LABELS, type Me } from "@/lib/permissions";

const ICONS: Record<string, LucideIcon> = {
  inbox: InboxIcon, building: BuildingIcon, check: CheckSquareIcon, message: MessageSquareIcon,
  megaphone: MegaphoneIcon, handshake: HandshakeIcon, calendar: CalendarDaysIcon, package: PackageIcon,
  graduation: GraduationCapIcon, chart: ChartLineIcon, users: UsersIcon, gauge: GaugeIcon,
  shield: ShieldIcon, history: HistoryIcon,
};
const GROUPS: NavGroup[] = ["Workspace", "Departments", "Admin"];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ me, items }: { me: Me; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <span className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md text-sm font-semibold">
                  HC
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Hard-Code Ops</span>
                  <span className="text-muted-foreground truncate text-xs">{ROLE_LABELS[me.role]}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (!groupItems.length) return null;
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {groupItems.map((item) => {
                    const Icon = ICONS[item.icon] ?? InboxIcon;
                    const active = isActive(pathname, item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            <Icon aria-hidden />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
