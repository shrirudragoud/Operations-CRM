import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SchoolIcon, UploadIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireArea } from "@/lib/auth";
import { canCreateInstitution, canImportInstitutions } from "@/lib/permissions";
import { listInstitutions, listOwners } from "@/lib/queries/institution";
import { DEFAULT_LIST_PARAMS, PAGE_SIZE, listQuery, parseListParams } from "@/lib/schemas/institution";
import { createClient } from "@/utils/supabase/server";
import { InstitutionFilters } from "./institution-filters";
import { InstitutionTable } from "./institution-table";

export const metadata: Metadata = { title: "Institutions" };

export default async function InstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { me, allowed } = await requireArea("institutions");
  const isPartner = me.role === "partner";
  const title = isPartner ? "My institutions" : "Institutions";
  const canCreate = canCreateInstitution(me);
  const actions = (
    <>
      {canCreate && canImportInstitutions(me) && !isPartner && (
        <Button asChild variant="outline">
          <Link href="/institutions/import"><UploadIcon aria-hidden /> Import CSV</Link>
        </Button>
      )}
      {canCreate && (
        <Button asChild>
          <Link href="/institutions/new"><PlusIcon aria-hidden /> New institution</Link>
        </Button>
      )}
    </>
  );
  const header = (
    <PageHeader
      title={title}
      description={isPartner ? "The schools and colleges you own." : "Every school, college and university we work with."}
      actions={allowed ? actions : undefined}
    />
  );
  if (!allowed) return <>{header}<AccessDenied what="institutions" /></>;

  const params = parseListParams(await searchParams);
  const supabase = await createClient();
  const showOwnerFilter = !isPartner;
  const [listRes, ownersRes] = await Promise.all([
    listInstitutions(supabase, params),
    showOwnerFilter ? listOwners(supabase) : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
  ]);

  const rows = listRes.data ?? [];
  const total = listRes.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = listQuery({ ...params, page: 1, sort: DEFAULT_LIST_PARAMS.sort, desc: false }) !== "";
  const href = (page: number) => {
    const qs = listQuery({ ...params, page });
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      {header}
      <InstitutionFilters params={params} owners={ownersRes.data ?? []} showOwnerFilter={showOwnerFilter} />
      {listRes.error ? (
        <LoadError what="institutions" />
      ) : total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SchoolIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>{filtered ? "No institutions match these filters" : "No institutions yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try a different search, or clear the filters to see everything."
                : canCreate
                  ? "Add the first one, or import a spreadsheet of many at once."
                  : "Nothing has been added yet."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button asChild variant="outline"><Link href="/institutions">Clear filters</Link></Button>
            ) : (
              canCreate && (
                <div className="flex gap-2">
                  <Button asChild><Link href="/institutions/new"><PlusIcon aria-hidden /> New institution</Link></Button>
                  {!isPartner && (
                    <Button asChild variant="outline"><Link href="/institutions/import"><UploadIcon aria-hidden /> Import CSV</Link></Button>
                  )}
                </div>
              )
            )}
          </EmptyContent>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>That page is past the end</EmptyTitle>
            <EmptyDescription>There are {total} results in {pages} pages.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline"><Link href={href(1)}>Back to page 1</Link></Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          <InstitutionTable rows={rows} params={params} />
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              Page {params.page} of {pages} · {total} {total === 1 ? "institution" : "institutions"}
            </p>
            <div className="flex gap-2">
              {params.page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(params.page - 1)} rel="prev"><ChevronLeftIcon aria-hidden /> Previous</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled><ChevronLeftIcon aria-hidden /> Previous</Button>
              )}
              {params.page < pages ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(params.page + 1)} rel="next">Next <ChevronRightIcon aria-hidden /></Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>Next <ChevronRightIcon aria-hidden /></Button>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
