"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArchiveIcon, ArchiveRestoreIcon, GaugeIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { archiveInstitution, correctInstitutionStage, restoreInstitution } from "@/lib/actions/institution";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/schemas/institution";

type Props = {
  id: string;
  name: string;
  stage: Stage;
  archived: boolean;
  canArchive: boolean;
  canCorrectStage: boolean;
};

export function InstitutionActions({ id, name, stage, archived, canArchive, canCorrectStage }: Props) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [stageOpen, setStageOpen] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [newStage, setNewStage] = useState<Stage>(stage);
  const [pending, startTransition] = useTransition();

  function toggleArchive() {
    setArchiveError(null);
    startTransition(async () => {
      const res = archived ? await restoreInstitution({ id }) : await archiveInstitution({ id });
      if (!res.ok) {
        setArchiveError(res.error);
        return;
      }
      toast.success(archived ? `${name} was restored` : `${name} was archived`);
      setArchiveOpen(false);
    });
  }

  function correct() {
    setStageError(null);
    startTransition(async () => {
      const res = await correctInstitutionStage({ id, stage: newStage });
      if (!res.ok) {
        setStageError(res.error);
        return;
      }
      toast.success(`Stage corrected to ${STAGE_LABELS[newStage]}`);
      setStageOpen(false);
    });
  }

  if (!canArchive && !canCorrectStage) return null;

  return (
    <>
      {canCorrectStage && (
        <Button
          variant="outline"
          onClick={() => {
            setNewStage(stage);
            setStageError(null);
            setStageOpen(true);
          }}
        >
          <GaugeIcon aria-hidden /> Correct stage
        </Button>
      )}
      {canArchive && (
        <Button
          variant="outline"
          onClick={() => {
            setArchiveError(null);
            setArchiveOpen(true);
          }}
        >
          {archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />}
          {archived ? "Restore" : "Archive"}
        </Button>
      )}

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archived ? `Restore ${name}?` : `Archive ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "It comes back into the main institution list. Nothing was deleted."
                : "It is hidden from the main list but its contacts and history stay. You can restore it later. Open deals or scheduled events must be closed first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{archiveError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open to show the database's rule message
                toggleArchive();
              }}
            >
              {pending && <Spinner />} {archived ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stageOpen} onOpenChange={setStageOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Correct the stage of {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The stage normally moves by itself as activities, deals and events are recorded. Only correct it
              here to fix a mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="correct-stage">New stage</FieldLabel>
            <Select value={newStage} onValueChange={(v) => setNewStage(v as Stage)}>
              <SelectTrigger id="correct-stage" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {stageError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{stageError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || newStage === stage}
              onClick={(e) => {
                e.preventDefault();
                correct();
              }}
            >
              {pending && <Spinner />} Correct stage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
