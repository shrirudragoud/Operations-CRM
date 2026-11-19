import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { ChecklistTick } from "@/components/requests/checklist-tick";
import { StartForm, TemplateForm, TemplateRowActions } from "@/components/requests/onboarding-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { listStaffChoices } from "@/lib/queries/documents";
import { listProgress, listTasksFor, listTemplates } from "@/lib/queries/hr-requests";
import { ONBOARDING_KINDS, ONBOARDING_LABELS, OWNER_LABELS, type OnboardingKind, type OnboardingOwner } from "@/lib/schemas/hr-requests";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Joining and leaving" };

const crumbs = [{ label: "People & HR", href: "/hr" }, { label: "Joining and leaving" }];

export default async function HrOnboardingPage() {
  const { allowed } = await requireArea("hr");
  const header = <PageHeader title="Joining and leaving" description="Checklists for people who are joining or leaving." crumbs={crumbs} />;
  if (!allowed) return <>{header}<AccessDenied what="People & HR" /></>;

  const supabase = await createClient();
  const [progress, templates, people] = await Promise.all([listProgress(supabase), listTemplates(supabase), listStaffChoices(supabase)]);
  if (progress.error || templates.error) return <>{header}<LoadError what="the checklists" /></>;

  const running = (progress.data ?? []).filter((p) => p.done < p.total);
  const finished = (progress.data ?? []).filter((p) => p.done >= p.total);
  const tasks = await Promise.all(running.map((p) => listTasksFor(supabase, p.staff_id)));

  return (
    <>
      {header}
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Start a checklist</CardTitle>
            <CardDescription>The steps below are copied for the person, with dates counted from their first or last day.</CardDescription>
          </CardHeader>
          <CardContent><StartForm people={people.data ?? []} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Running</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {running.length === 0 ? (
              <p className="text-muted-foreground text-sm">No checklist is running.</p>
            ) : (
              running.map((p, i) => {
                const mine = (tasks[i]?.data ?? []).filter((t) => t.kind === p.kind);
                return (
                  <section key={`${p.staff_id}-${p.kind}`} aria-label={`${p.full_name}: ${ONBOARDING_LABELS[p.kind as OnboardingKind]}`} className="grid gap-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{p.full_name}</h3>
                      <Badge variant="secondary">{ONBOARDING_LABELS[p.kind as OnboardingKind]}</Badge>
                      <span className="text-muted-foreground text-xs">{p.done} of {p.total} done{p.next_due ? ` · next due ${formatDate(p.next_due)}` : ""}</span>
                    </div>
                    <ul className="grid gap-3" aria-label={`Steps for ${p.full_name}`}>
                      {mine.map((t) => (
                        <li key={t.id} className="flex items-start gap-3">
                          <ChecklistTick id={t.id} title={`${t.title} for ${p.full_name}`} done={!!t.done_at} />
                          <div className="text-sm">
                            <div className={t.done_at ? "text-muted-foreground line-through" : "font-medium"}>{t.title}</div>
                            <div className="text-muted-foreground text-xs">
                              {OWNER_LABELS[t.owner as OnboardingOwner]}{t.assignee?.full_name ? ` (${t.assignee.full_name})` : ""} · due {formatDate(t.due_on)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </CardContent>
        </Card>

        {finished.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Finished</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Person</TableHead><TableHead>Checklist</TableHead><TableHead>Finished</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {finished.map((p) => (
                    <TableRow key={`${p.staff_id}-${p.kind}`}>
                      <TableCell>{p.full_name}</TableCell>
                      <TableCell>{ONBOARDING_LABELS[p.kind as OnboardingKind]}</TableCell>
                      <TableCell>{formatDate(p.completed_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>The standard steps</CardTitle>
            <CardDescription>What a new checklist is copied from. Changing these does not touch checklists already running.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {ONBOARDING_KINDS.map((k) => {
              const rows = (templates.data ?? []).filter((t) => t.kind === k);
              return (
                <div key={k} className="grid gap-2">
                  <h3 className="font-medium">{ONBOARDING_LABELS[k]}</h3>
                  <Table aria-label={`Standard steps: ${ONBOARDING_LABELS[k]}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Step</TableHead>
                        <TableHead>Who does it</TableHead>
                        <TableHead>Days from the {k === "joiner" ? "first" : "last"} day</TableHead>
                        <TableHead className="text-right">Use</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{t.title}</TableCell>
                          <TableCell>{OWNER_LABELS[t.owner as OnboardingOwner]}</TableCell>
                          <TableCell>{t.due_offset}</TableCell>
                          <TableCell><TemplateRowActions id={t.id} title={t.title} active={t.is_active} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
            <TemplateForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
