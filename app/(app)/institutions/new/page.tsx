import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { canCreateInstitution } from "@/lib/permissions";
import { listOwners } from "@/lib/queries/institution";
import { createClient } from "@/utils/supabase/server";
import { NewInstitution } from "./new-institution";

export const metadata: Metadata = { title: "New institution" };

export default async function NewInstitutionPage() {
  const { me, allowed } = await requireArea("institutions");
  const crumbs = [{ label: "Institutions", href: "/institutions" }, { label: "New" }];
  const header = <PageHeader title="New institution" crumbs={crumbs} description="Its stage starts at Prospect and moves as you log activities, deals and events." />;
  if (!allowed || !canCreateInstitution(me)) {
    return <>{header}<AccessDenied what="creating institutions" /></>;
  }

  const isPartner = me.role === "partner";
  const owners = isPartner ? [] : ((await listOwners(await createClient())).data ?? []);
  return (
    <>
      {header}
      <Card className="max-w-3xl">
        <CardContent>
          <NewInstitution owners={owners} showOwner={!isPartner} defaultOwnerId={isPartner ? me.id : ""} />
        </CardContent>
      </Card>
    </>
  );
}
