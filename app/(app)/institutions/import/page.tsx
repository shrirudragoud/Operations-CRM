import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { canImportInstitutions } from "@/lib/permissions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import institutions" };

export default async function ImportPage() {
  const { me, allowed } = await requireArea("institutions");
  const header = (
    <PageHeader
      title="Import institutions"
      crumbs={[{ label: "Institutions", href: "/institutions" }, { label: "Import" }]}
      description="Add many institutions at once from a spreadsheet."
    />
  );
  if (!allowed || me.role === "partner" || !canImportInstitutions(me)) {
    return <>{header}<AccessDenied what="importing institutions" /></>;
  }
  return (
    <>
      {header}
      <Card>
        <CardContent>
          <ImportForm />
        </CardContent>
      </Card>
    </>
  );
}
