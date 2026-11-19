"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { DateField, TimeField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createTask } from "@/lib/actions/task";
import { DEPARTMENTS, DEPARTMENT_LABELS, type Department } from "@/lib/permissions";
import {
  createTaskSchema, MAX_TASK_GROUP, PRIORITIES, PRIORITY_LABELS, TASK_CATEGORIES, TASK_CATEGORY_LABELS,
  type CreateTaskInput, type CreateTaskValues,
} from "@/lib/schemas/task";

export type StaffOption = { id: string; full_name: string; departments?: Department[] };

const UNASSIGNED = "unassigned";
const NONE = "none";

type Props = {
  owners: StaffOption[];
  /** Pre-selected when the task is created from a department workspace; otherwise leave it out. */
  defaultDepartment?: Department | null;
  meId: string;
  /** Creating a subtask: the parent's id. The dialog then stays on the parent page. */
  parentTaskId?: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  entity?: { type: "institution" | "deal" | "event"; id: string };
};

/** Create a task for anyone internal, with or without a department, for one person or several. The database stamps the creator and checks the rules. */
export function NewTaskButton({ owners, defaultDepartment = null, meId, parentTaskId, label = "New task", variant = "default", entity }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><PlusIcon aria-hidden /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <TaskForm
            owners={owners}
            defaultDepartment={defaultDepartment}
            meId={meId}
            parentTaskId={parentTaskId}
            entity={entity}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskForm({ owners, defaultDepartment = null, meId, parentTaskId, entity, onDone }: Omit<Props, "label" | "variant"> & { onDone: () => void }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const form = useForm<CreateTaskInput, unknown, CreateTaskValues>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      title: "", description: "", department: defaultDepartment ?? "", category: "", assignee_id: "", also_assignee_ids: [], start_date: "", due_date: "", due_time: "",
      priority: "3", estimate_minutes: "", parent_task_id: parentTaskId ?? "",
      entity_type: entity?.type ?? null, entity_id: entity?.id ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const first = useWatch({ control: form.control, name: "assignee_id" });

  async function onSubmit() {
    setServerError(null);
    const res = await createTask(form.getValues());
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof CreateTaskInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    const people = (form.getValues("also_assignee_ids") ?? []).length + (form.getValues("assignee_id") ? 1 : 0);
    toast.success(parentTaskId ? "Subtask added" : people > 1 ? `${people} tasks created, one for each person` : "Task created");
    onDone();
    if (!parentTaskId) router.push(`/tasks/${res.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>{parentTaskId ? "New subtask" : "New task"}</DialogTitle>
        <DialogDescription>
          {parentTaskId ? "A step of the task above." : "Give it to one or more teammates, in any department or none, or leave it unassigned for the team to pick up."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="task-title">Title</FieldLabel>
          <Input id="task-title" autoComplete="off" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="task-description">Details (optional)</FieldLabel>
          <Textarea id="task-description" rows={3} aria-invalid={!!errors.description} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.assignee_id}>
            <FieldLabel htmlFor="task-assignee">Assign to</FieldLabel>
            <Controller
              control={form.control}
              name="assignee_id"
              render={({ field }) => (
                <Select
                  value={field.value || UNASSIGNED}
                  onValueChange={(v) => {
                    field.onChange(v === UNASSIGNED ? "" : v);
                    form.setValue("also_assignee_ids", (form.getValues("also_assignee_ids") ?? []).filter((x) => x !== v));
                  }}
                >
                  <SelectTrigger id="task-assignee" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned (team queue)</SelectItem>
                    {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.id === meId ? `${o.full_name} (me)` : o.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.assignee_id]} />
          </Field>
          <Field data-invalid={!!errors.department}>
            <FieldLabel htmlFor="task-department">Department</FieldLabel>
            <Controller
              control={form.control}
              name="department"
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger id="task-department" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No department</SelectItem>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>Optional. A department&apos;s team sees its tasks.</FieldDescription>
            <FieldError errors={[errors.department]} />
          </Field>
        </div>
        {!parentTaskId && !entity && (
          <Field data-invalid={!!errors.also_assignee_ids}>
            <FieldLabel htmlFor="task-also-filter">Also give it to (optional)</FieldLabel>
            <Controller
              control={form.control}
              name="also_assignee_ids"
              render={({ field }) => {
                const picked = field.value ?? [];
                const shown = owners.filter((o) => o.id !== first && o.full_name.toLowerCase().includes(filter.trim().toLowerCase()));
                return (
                  <>
                    <Input id="task-also-filter" placeholder="Search by name" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
                    <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="More people">
                      {shown.map((o) => {
                        const id = `task-also-${o.id}`;
                        return (
                          <li key={o.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              id={id}
                              checked={picked.includes(o.id)}
                              disabled={!picked.includes(o.id) && picked.length + (first ? 1 : 0) >= MAX_TASK_GROUP}
                              onCheckedChange={(on) => field.onChange(on ? [...picked, o.id] : picked.filter((x) => x !== o.id))}
                            />
                            <label htmlFor={id}>{o.id === meId ? `${o.full_name} (me)` : o.full_name}</label>
                          </li>
                        );
                      })}
                      {shown.length === 0 && <li className="text-muted-foreground text-sm">Nobody matches.</li>}
                    </ul>
                    <FieldDescription>
                      {picked.length > 0
                        ? `Each of the ${picked.length + (first ? 1 : 0)} people gets their own task to finish on their own time.`
                        : "Everyone you pick gets their own copy of the task."}
                    </FieldDescription>
                  </>
                );
              }}
            />
            <FieldError errors={[errors.also_assignee_ids as { message?: string } | undefined]} />
          </Field>
        )}
        <Field data-invalid={!!errors.category}>
          <FieldLabel htmlFor="task-category">Category</FieldLabel>
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                <SelectTrigger id="task-category" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {TASK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.category]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.start_date}>
            <FieldLabel htmlFor="task-start-date">Start date</FieldLabel>
            <Controller control={form.control} name="start_date" render={({ field }) => <DateField id="task-start-date" value={field.value} onChange={field.onChange} invalid={!!errors.start_date} />} />
            <FieldError errors={[errors.start_date]} />
          </Field>
          <Field data-invalid={!!errors.due_date}>
            <FieldLabel htmlFor="task-due-date">Deadline</FieldLabel>
            <Controller control={form.control} name="due_date" render={({ field }) => <DateField id="task-due-date" value={field.value} onChange={field.onChange} invalid={!!errors.due_date} />} />
            <FieldError errors={[errors.due_date]} />
          </Field>
          <Field data-invalid={!!errors.due_time}>
            <FieldLabel htmlFor="task-due-time">Deadline time (India)</FieldLabel>
            <Controller control={form.control} name="due_time" render={({ field }) => <TimeField id="task-due-time" value={field.value} onChange={field.onChange} invalid={!!errors.due_time} />} />
            <FieldError errors={[errors.due_time]} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.priority}>
            <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Select value={String(field.value ?? "3")} onValueChange={field.onChange}>
                  <SelectTrigger id="task-priority" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={String(p)}>{PRIORITY_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.priority]} />
          </Field>
          <Field data-invalid={!!errors.estimate_minutes}>
            <FieldLabel htmlFor="task-estimate">Estimate (minutes)</FieldLabel>
            <Input id="task-estimate" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.estimate_minutes} {...form.register("estimate_minutes")} />
            <FieldDescription>Optional. Helps plan the day.</FieldDescription>
            <FieldError errors={[errors.estimate_minutes]} />
          </Field>
        </div>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} {parentTaskId ? "Add subtask" : "Create task"}</Button>
      </DialogFooter>
    </form>
  );
}
