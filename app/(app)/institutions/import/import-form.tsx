"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2Icon, DownloadIcon, UploadIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importInstitutions } from "@/lib/actions/institution";
import {
  CSV_COLUMNS, MAX_IMPORT_ROWS, institutionTemplateCsv, parseInstitutionCsv, type ImportResult,
} from "@/lib/csv/institutions";

const MAX_BYTES = 2 * 1024 * 1024;

type Parsed = { fileName: string; rows: Extract<ReturnType<typeof parseInstitutionCsv>, { ok: true }>["rows"]; ignored: string[] };

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([institutionTemplateCsv()], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "institutions-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportForm() {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setParsed(null);
    setCheck(null);
    setDone(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function onFile(file: File | undefined) {
    setParsed(null);
    setCheck(null);
    setDone(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 2 MB. Split it into smaller files.");
      return;
    }
    const result = parseInstitutionCsv(await file.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setParsed({ fileName: file.name, rows: result.rows, ignored: result.ignoredColumns });
    startTransition(async () => {
      const res = await importInstitutions({ rows: result.rows, dryRun: true });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCheck(res.data);
    });
  }

  function commit() {
    if (!parsed) return;
    setError(null);
    startTransition(async () => {
      const res = await importInstitutions({ rows: parsed.rows, dryRun: false });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.errors.length > 0) {
        setCheck(res.data);
        setError("Nothing was imported because some rows have problems. Fix them and upload the file again.");
        return;
      }
      setDone(res.data);
      toast.success(`Imported ${res.data.inserted} institutions`);
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert>
          <CheckCircle2Icon aria-hidden />
          <AlertTitle>Imported {done.inserted} institutions</AlertTitle>
          <AlertDescription>They start at the Prospect stage. Ownership is set from the owner_email column where given.</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button asChild><Link href="/institutions">View institutions</Link></Button>
          <Button variant="outline" onClick={reset}>Import another file</Button>
        </div>
      </div>
    );
  }

  const clean = check !== null && check.errors.length === 0 && check.valid > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2 text-sm">
        <p>
          Upload a CSV with these columns: <code className="text-xs">{CSV_COLUMNS.join(", ")}</code>. Only{" "}
          <strong>name</strong> and <strong>kind</strong> are required. Up to {MAX_IMPORT_ROWS} rows.
          Nothing is saved until you confirm, and it is all or nothing.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
          <DownloadIcon aria-hidden /> Download template
        </Button>
      </div>

      <Field>
        <FieldLabel htmlFor="import-file">CSV file</FieldLabel>
        <Input
          id="import-file"
          ref={input}
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <FieldDescription>The file is checked first. You will see every problem before anything is saved.</FieldDescription>
      </Field>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pending && !check && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Spinner /> Checking the file...
        </p>
      )}

      {parsed && parsed.ignored.length > 0 && (
        <Alert role="status">
          <AlertDescription>Ignored columns: {parsed.ignored.join(", ")}.</AlertDescription>
        </Alert>
      )}

      {check && (
        <section aria-label="Check result" className="space-y-4">
          <p className="text-sm" role="status">
            <strong>{check.valid}</strong> of <strong>{check.total}</strong> rows are ready
            {check.errors.length > 0 && <>; <strong>{check.errors.length}</strong> need fixing</>}.
            Nothing has been saved yet.
          </p>

          {check.errors.length > 0 && (
            <Table aria-label="Rows with problems">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Problem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {check.errors.map((e, i) => (
                  <TableRow key={`${e.row}-${i}`}>
                    <TableCell>{e.row}</TableCell>
                    <TableCell>{e.name || <span className="text-muted-foreground">(blank)</span>}</TableCell>
                    <TableCell>{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex flex-wrap gap-2">
            {clean ? (
              <Button onClick={commit} disabled={pending}>
                {pending ? <Spinner /> : <UploadIcon aria-hidden />} Import {check.valid} {check.valid === 1 ? "institution" : "institutions"}
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm">
                Fix the rows above in your spreadsheet and choose the file again. Row numbers count data rows, not the header.
              </p>
            )}
            <Button variant="outline" onClick={reset} disabled={pending}>Start over</Button>
          </div>
        </section>
      )}
    </div>
  );
}
