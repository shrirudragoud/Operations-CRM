"use client";

import { Controller, type Control, type FieldErrors, type UseFormSetValue, useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet,
} from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DEPARTMENTS, DEPARTMENT_LABELS, ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, roleNeedsDepartments,
  type Department, type Role,
} from "@/lib/permissions";

export type AccessValues = { role: Role; departments: Department[] };

// Role + departments, shared by the invite and edit dialogs. Departments are hidden for founder
// (all) and partner (none) and cleared when switching to those roles, mirroring ops.check_access_shape.
export function AccessFields<T extends AccessValues>({
  control, errors, setValue, idPrefix,
}: {
  control: Control<T>;
  errors: FieldErrors<T>;
  setValue: UseFormSetValue<T>;
  idPrefix: string;
}) {
  const c = control as unknown as Control<AccessValues>;
  const set = setValue as unknown as UseFormSetValue<AccessValues>;
  const errs = errors as FieldErrors<AccessValues>;
  const role = useWatch({ control: c, name: "role" });

  return (
    <>
      <Controller
        control={c}
        name="role"
        render={({ field }) => (
          <Field data-invalid={!!errs.role}>
            <FieldLabel htmlFor={`${idPrefix}-role`}>Role</FieldLabel>
            <Select
              value={field.value}
              onValueChange={(v) => {
                field.onChange(v);
                if (!roleNeedsDepartments(v as Role)) set("departments", [], { shouldValidate: true });
              }}
            >
              <SelectTrigger id={`${idPrefix}-role`} aria-invalid={!!errs.role} className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role && <FieldDescription>{ROLE_DESCRIPTIONS[role]}</FieldDescription>}
            <FieldError errors={[errs.role]} />
          </Field>
        )}
      />
      {role && roleNeedsDepartments(role) && (
        <Controller
          control={c}
          name="departments"
          render={({ field }) => (
            <FieldSet data-invalid={!!errs.departments}>
              <FieldLegend variant="label">Departments</FieldLegend>
              <div className="grid grid-cols-2 gap-2">
                {DEPARTMENTS.map((d) => {
                  const id = `${idPrefix}-dept-${d}`;
                  const checked = field.value.includes(d);
                  return (
                    <Field key={d} orientation="horizontal">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(on) =>
                          field.onChange(on ? [...field.value, d] : field.value.filter((x) => x !== d))
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={id} className="font-normal">{DEPARTMENT_LABELS[d]}</FieldLabel>
                      </FieldContent>
                    </Field>
                  );
                })}
              </div>
              <FieldError errors={[errs.departments as { message?: string } | undefined]} />
            </FieldSet>
          )}
        />
      )}
    </>
  );
}
