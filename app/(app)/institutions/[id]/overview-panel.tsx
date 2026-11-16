"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KIND_LABELS } from "@/lib/schemas/institution";
import { formatDate } from "@/lib/format";
import type { OwnerOption } from "../institution-filters";
import { InstitutionForm, type EditableInstitution } from "../institution-form";

type Props = {
  institution: EditableInstitution & { created_at: string; updated_at: string; owner_name: string | null };
  owners: OwnerOption[];
  canEdit: boolean;
  showOwner: boolean;
};

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium">{value || <span className="text-muted-foreground font-normal">Not set</span>}</dd>
    </div>
  );
}

export function OverviewPanel({ institution, owners, canEdit, showOwner }: Props) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  if (editing) {
    return (
      <InstitutionForm
        key={institution.updated_at}
        institution={institution}
        owners={owners}
        showOwner={showOwner}
        onSaved={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Kind" value={KIND_LABELS[institution.kind]} />
        <Item label="Affiliation" value={institution.affiliation} />
        <Item label="Source" value={institution.source} />
        <Item label="City" value={institution.city} />
        <Item label="District" value={institution.district} />
        <Item label="State" value={institution.state} />
        <Item label="Owner" value={institution.owner_name} />
        <Item label="Added" value={formatDate(institution.created_at)} />
        <Item label="Last updated" value={formatDate(institution.updated_at)} />
      </dl>
      {canEdit && (
        <Button variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon aria-hidden /> Edit details
        </Button>
      )}
    </div>
  );
}
