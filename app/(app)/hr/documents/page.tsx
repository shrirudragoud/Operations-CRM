import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { OpenButton, RemoveButton, VerifyButtons } from "@/components/documents/document-buttons";
import { UploadForm } from "@/components/documents/upload-form";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  getAckSummary, listAllLibrary, listExpiring, listPapersToVerify, listRecentlyVerified, listStaffChoices,
} from "@/lib/queries/documents";
import {
  AUDIENCE_LABELS, COMPANY_DOC_LABELS, STAFF_DOC_LABELS, documentStatus, expiryLabel, type Audience, type CompanyDocKind, type StaffDocKind,
} from "@/lib/schemas/documents";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Documents" };

const crumbs = [{ label: "People & HR", href: "/hr" }, { label: "Documents" }];

export default async function HrDocumentsPage() {
  const { me, allowed } = await requireArea("hr");
  const header = <PageHeader title="Documents" description="Verify papers, watch for expiries and publish policies." crumbs={crumbs} />;
  if (!allowed) return <>{header}<AccessDenied what="People & HR" /></>;

  const supabase = await createClient();
  const [waiting, verified, expiring, library, summary, people] = await Promise.all([
    listPapersToVerify(supabase), listRecentlyVerified(supabase), listExpiring(supabase, 60),
    listAllLibrary(supabase), getAckSummary(supabase), listStaffChoices(supabase),
  ]);
  const ackFor = new Map((summary.data ?? []).map((s) => [s.document_id, s]));

  return (
    <>
      {header}
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Expiring soon</CardTitle>
            <CardDescription>Papers that expire within 60 days, or already have. Only people who are still active.</CardDescription>
          </CardHeader>
          <CardContent>
            {expiring.error ? (
              <LoadError what="the expiry list" />
            ) : !expiring.data?.length ? (
              <p className="text-muted-foreground text-sm">Nothing expires in the next 60 days.</p>
            ) : (
              <Table aria-label="Expiring documents">
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiring.data.map((d) => (
                    <TableRow key={d.document_id}>
                      <TableCell>{d.full_name}</TableCell>
                      <TableCell>{d.title} <span className="text-muted-foreground text-xs">{STAFF_DOC_LABELS[d.kind as StaffDocKind] ?? d.kind}</span></TableCell>
                      <TableCell>
                        <Badge variant={d.days_left < 0 ? "destructive" : d.days_left <= 14 ? "secondary" : "outline"}>{expiryLabel(d.days_left)}</Badge>
                        <span className="text-muted-foreground ps-2 text-xs">{formatDate(d.expires_on)}</span>
                      </TableCell>
                      <TableCell className="text-end"><OpenButton id={d.document_id} title={d.title} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Waiting to be verified</CardTitle>
            <CardDescription>Opening a paper is written to the access log, and the person can see that.</CardDescription>
          </CardHeader>
          <CardContent>
            {waiting.error ? (
              <LoadError what="the papers" />
            ) : !waiting.data?.length ? (
              <p className="text-muted-foreground text-sm">Nothing is waiting.</p>
            ) : (
              <Table aria-label="Papers waiting to be verified">
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {waiting.data.map((d) => {
                    const status = documentStatus(d);
                    return (
                      <TableRow key={d.id}>
                        <TableCell>{d.owner?.full_name ?? "Unknown"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{d.title}</div>
                          <div className="text-muted-foreground text-xs">
                            {STAFF_DOC_LABELS[d.kind as StaffDocKind] ?? d.kind} · added {formatDate(d.created_at)}
                            {status === "declined" && " · sent back, waiting for a new copy"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-1 whitespace-nowrap [&>*]:shrink-0">
                            <OpenButton id={d.id} title={d.title} />
                            {d.staff_id !== me.id && status === "pending" && <VerifyButtons id={d.id} title={d.title} />}
                            <RemoveButton id={d.id} title={d.title} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {!!verified.data?.length && (
              <p className="text-muted-foreground pt-4 text-xs">
                Recently verified: {verified.data.slice(0, 8).map((d) => `${d.owner?.full_name ?? "Unknown"} (${d.title})`).join(", ")}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add a document to someone&apos;s record</CardTitle>
            <CardDescription>For papers only HR keeps: an offer letter, a contract or a payslip.</CardDescription>
          </CardHeader>
          <CardContent><UploadForm mode="for_person" people={people.data ?? []} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policies and handbook</CardTitle>
            <CardDescription>Publishing a title that is already live starts its next version and everyone has to read it again.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {library.error ? (
              <LoadError what="the library" />
            ) : !library.data?.length ? (
              <p className="text-muted-foreground text-sm">Nothing is published yet.</p>
            ) : (
              <Table aria-label="Published documents">
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Read by</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {library.data.map((d) => {
                    const a = ackFor.get(d.id);
                    return (
                      <TableRow key={d.id}>
                        <TableCell>
                          <div className="font-medium">{d.title} <span className="text-muted-foreground text-xs font-normal">version {d.version}</span></div>
                          <div className="text-muted-foreground text-xs">
                            {COMPANY_DOC_LABELS[d.kind as CompanyDocKind] ?? d.kind} · {AUDIENCE_LABELS[d.audience as Audience] ?? d.audience} · {formatDate(d.created_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {d.is_active ? (a ? `${a.acknowledged} of ${a.eligible}` : "-") : <Badge variant="outline">Retired</Badge>}
                        </TableCell>
                        <TableCell>
                          {d.is_active && (
                            <div className="flex justify-end gap-1 whitespace-nowrap [&>*]:shrink-0">
                              <OpenButton id={d.id} title={d.title} company />
                              <RemoveButton id={d.id} title={d.title} retire />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <div>
              <h3 className="pb-3 text-sm font-medium">Publish a document</h3>
              <UploadForm mode="publish" />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
