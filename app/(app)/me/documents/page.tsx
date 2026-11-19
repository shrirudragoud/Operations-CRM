import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { OpenButton, AcknowledgeButton, RemoveButton } from "@/components/documents/document-buttons";
import { UploadForm } from "@/components/documents/upload-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { canHaveProfile } from "@/lib/portal";
import { listLibrary, listMyAcknowledgements, listMyDocuments } from "@/lib/queries/documents";
import {
  AUDIENCE_LABELS, COMPANY_DOC_LABELS, STAFF_DOC_LABELS, documentStatus, formatBytes, type Audience, type CompanyDocKind, type StaffDocKind,
} from "@/lib/schemas/documents";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "My documents" };

const STATUS = {
  verified: { label: "Verified by HR", variant: "default" },
  declined: { label: "Sent back", variant: "destructive" },
  pending: { label: "Waiting for HR", variant: "secondary" },
} as const;

export default async function MyDocumentsPage() {
  const me = await requireMe();
  if (!canHaveProfile(me)) {
    return <p className="text-muted-foreground text-sm">Documents are kept for team members. Your role doesn&apos;t have any.</p>;
  }
  const supabase = await createClient();
  const [mine, library, acks] = await Promise.all([
    listMyDocuments(supabase, me.id), listLibrary(supabase), listMyAcknowledgements(supabase, me.id),
  ]);

  const read = new Map((acks.data ?? []).map((a) => [`${a.document_id}:${a.version}`, a.at]));

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>My documents</CardTitle>
          <CardDescription>Your ID, address proof and certificates. Only you and HR can open them, and every time HR opens one it is logged.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {mine.error ? (
            <LoadError what="your documents" />
          ) : !mine.data?.length ? (
            <p className="text-muted-foreground text-sm">You haven&apos;t added any documents yet.</p>
          ) : (
            <Table aria-label="My documents">
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Expires</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.data.map((d) => {
                  const status = documentStatus(d);
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="font-medium">{d.title}</div>
                        <div className="text-muted-foreground text-xs">
                          {STAFF_DOC_LABELS[d.kind as StaffDocKind] ?? d.kind} · {formatBytes(d.size_bytes)} · added {formatDate(d.created_at)}
                        </div>
                        {status === "declined" && <div className="text-destructive text-xs">HR says: {d.verify_note}</div>}
                      </TableCell>
                      <TableCell><Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge></TableCell>
                      <TableCell className="hidden sm:table-cell">{d.expires_on ? formatDate(d.expires_on) : "-"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1 whitespace-nowrap [&>*]:shrink-0">
                          <OpenButton id={d.id} title={d.title} />
                          {status !== "verified" && <RemoveButton id={d.id} title={d.title} />}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div>
            <h3 className="pb-3 text-sm font-medium">Add a document</h3>
            <UploadForm mode="own" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Policies and handbook</CardTitle>
          <CardDescription>Read each one and tick it off. When HR publishes a new version you are asked to read it again.</CardDescription>
        </CardHeader>
        <CardContent>
          {library.error ? (
            <LoadError what="the policies" />
          ) : !library.data?.length ? (
            <p className="text-muted-foreground text-sm">HR hasn&apos;t published anything yet.</p>
          ) : (
            <Table aria-label="Policies and handbook">
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Read</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {library.data.map((d) => {
                  const readAt = read.get(`${d.id}:${d.version}`);
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="font-medium">{d.title} <span className="text-muted-foreground text-xs font-normal">version {d.version}</span></div>
                        <div className="text-muted-foreground text-xs">
                          {COMPANY_DOC_LABELS[d.kind as CompanyDocKind] ?? d.kind} · {AUDIENCE_LABELS[d.audience as Audience] ?? d.audience} · published {formatDate(d.created_at)}
                        </div>
                        {d.summary && <div className="text-sm">{d.summary}</div>}
                      </TableCell>
                      <TableCell>{readAt ? <Badge variant="secondary">Read {formatDate(readAt)}</Badge> : <Badge variant="outline">Not read yet</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1 whitespace-nowrap [&>*]:shrink-0">
                          <OpenButton id={d.id} title={d.title} company />
                          {!readAt && <AcknowledgeButton id={d.id} title={d.title} />}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
