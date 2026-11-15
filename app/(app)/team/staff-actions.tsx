"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { MoreHorizontalIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { updateStaffAccess } from "@/lib/actions/team";
import type { Department, Role } from "@/lib/permissions";
import { updateAccessSchema, type UpdateAccessInput } from "@/lib/schemas/team";
import { AccessFields } from "./access-fields";

export type StaffRow = {
  id: string; full_name: string; email: string; role: Role; departments: Department[]; is_active: boolean;
};

export function StaffActions({ staff, isSelf }: { staff: StaffRow; isSelf: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    setConfirmError(null);
    startTransition(async () => {
      const res = await updateStaffAccess({
        staff_id: staff.id, role: staff.role, departments: staff.departments, is_active: !staff.is_active,
      });
      if (!res.ok) {
        setConfirmError(res.error);
        return;
      }
      toast.success(staff.is_active ? `${staff.full_name} was deactivated` : `${staff.full_name} was reactivated`);
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${staff.full_name}`}>
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit role and departments</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant={staff.is_active ? "destructive" : "default"}
            onSelect={() => {
              setConfirmError(null);
              setConfirmOpen(true);
            }}
          >
            {staff.is_active ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAccessDialog staff={staff} isSelf={isSelf} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {staff.is_active ? `Deactivate ${staff.full_name}?` : `Reactivate ${staff.full_name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {staff.is_active
                ? "They lose access to all data immediately. Their records and history stay. You can reactivate them later."
                : "They regain access with their current role and departments the next time they load a page."}
              {isSelf && staff.is_active && " This is your own account."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{confirmError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={staff.is_active ? "destructive" : "default"}
              disabled={pending}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open to show a rule error
                toggleActive();
              }}
            >
              {pending && <Spinner />} {staff.is_active ? "Deactivate" : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditAccessDialog({
  staff, isSelf, open, onOpenChange,
}: { staff: StaffRow; isSelf: boolean; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const defaults: UpdateAccessInput = {
    staff_id: staff.id, role: staff.role, departments: staff.departments, is_active: staff.is_active,
  };
  const form = useForm<UpdateAccessInput>({ resolver: zodResolver(updateAccessSchema), values: defaults });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: UpdateAccessInput) {
    setServerError(null);
    const res = await updateStaffAccess(values);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    toast.success(`Access updated for ${staff.full_name}`);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setServerError(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>Edit access: {staff.full_name}</DialogTitle>
            <DialogDescription>
              {staff.email}
              {isSelf && " (you). Demoting yourself is allowed only while another active founder exists."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <AccessFields control={form.control} errors={errors} setValue={form.setValue} idPrefix={`edit-${staff.id}`} />
          </FieldGroup>
          {serverError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
