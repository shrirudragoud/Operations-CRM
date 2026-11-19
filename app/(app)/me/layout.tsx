import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { PortalTabs } from "@/components/portal/portal-tabs";
import { requireArea } from "@/lib/auth";
import { portalTabsFor } from "@/lib/portal";

export default async function MeLayout({ children }: LayoutProps<"/me">) {
  const { me, allowed } = await requireArea("me");
  if (!allowed) return <><PageHeader title="My space" crumbs={[{ label: "My space" }]} /><AccessDenied what="your space" /></>;
  const tabs = portalTabsFor(me);
  return (
    <>
      <PageHeader title="My space" description="Your attendance, work and details in one place." crumbs={[{ label: "My space" }]} />
      {tabs.length > 1 && <PortalTabs tabs={tabs} />}
      {children}
    </>
  );
}
