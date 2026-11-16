"use client";

import { useRouter } from "next/navigation";
import { InstitutionForm } from "../institution-form";
import type { OwnerOption } from "../institution-filters";

export function NewInstitution({
  owners, showOwner, defaultOwnerId,
}: { owners: OwnerOption[]; showOwner: boolean; defaultOwnerId: string }) {
  const router = useRouter();
  return (
    <InstitutionForm
      owners={owners}
      showOwner={showOwner}
      defaultOwnerId={defaultOwnerId}
      onSaved={(id) => router.push(`/institutions/${id}`)}
      onCancel={() => router.push("/institutions")}
    />
  );
}
