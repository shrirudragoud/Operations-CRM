import { z } from "zod";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// The bucket allows the same four types (0033). Extension is derived from the type, never from the file name.
export const UPLOAD_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type UploadMime = keyof typeof UPLOAD_TYPES;
export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

export const STAFF_DOC_KINDS = ["id_proof", "address_proof", "education", "certificate", "offer_letter", "contract", "payslip", "other"] as const;
export type StaffDocKind = (typeof STAFF_DOC_KINDS)[number];
export const STAFF_DOC_LABELS: Record<StaffDocKind, string> = {
  id_proof: "ID proof",
  address_proof: "Address proof",
  education: "Education",
  certificate: "Certificate",
  offer_letter: "Offer letter",
  contract: "Contract",
  payslip: "Payslip",
  other: "Other",
};
/** What a person can add to their own record; the rest is HR's to add (ops.add_staff_document). */
export const OWN_DOC_KINDS = ["id_proof", "address_proof", "education", "certificate", "other"] as const satisfies readonly StaffDocKind[];

export const COMPANY_DOC_KINDS = ["policy", "handbook", "form", "other"] as const;
export type CompanyDocKind = (typeof COMPANY_DOC_KINDS)[number];
export const COMPANY_DOC_LABELS: Record<CompanyDocKind, string> = { policy: "Policy", handbook: "Handbook", form: "Form", other: "Other" };

export const AUDIENCES = ["everyone", "leads", "hr"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = { everyone: "Everyone", leads: "Leads only", hr: "HR only" };

export type UploadCheck = { ok: true; mime: UploadMime; ext: string } | { ok: false; error: string };

/** Magic numbers: a file must be what its type says, whatever the browser claims. */
export function sniffMime(bytes: Uint8Array): UploadMime | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export function checkUpload(file: { size: number; type: string }, head?: Uint8Array): UploadCheck {
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is over 10 MB. Choose a smaller one." };
  if (!(file.type in UPLOAD_TYPES)) return { ok: false, error: "Upload a PDF or an image (JPG, PNG or WebP)." };
  const mime = file.type as UploadMime;
  if (head && sniffMime(head) !== mime) return { ok: false, error: "That file doesn't look like a real " + UPLOAD_TYPES[mime].toUpperCase() + "." };
  return { ok: true, mime, ext: UPLOAD_TYPES[mime] };
}

/** A storage-safe file name: letters, digits, dot, dash and underscore only, never starting with a dot. */
export function safeFileName(original: string, ext: string): string {
  const base = original.replace(/\.[A-Za-z0-9]{1,5}$/, "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").replace(/\.{2,}/g, ".");
  return `${(base || "file").slice(0, 60)}.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-31.")]));

const title = z.string().trim().min(1, "Give the document a title.").max(140, "Keep the title under 140 characters.");

export const ownDocumentSchema = z.object({
  kind: z.enum(OWN_DOC_KINDS),
  title,
  expires_on: optionalDate,
});

export const hrDocumentSchema = z.object({
  staff_id: z.uuid(),
  kind: z.enum(STAFF_DOC_KINDS),
  title,
  expires_on: optionalDate,
});

export const publishSchema = z.object({
  title,
  kind: z.enum(COMPANY_DOC_KINDS),
  audience: z.enum(AUDIENCES),
  summary: z.string().trim().max(500, "Keep the summary under 500 characters."),
});

export const verifySchema = z.object({
  id: z.uuid(),
  ok: z.boolean(),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

/** A declined paper has no verified time but keeps HR's note; the person is asked for a better copy. */
export function documentStatus(d: { verified_at: string | null; verify_note: string | null }): "verified" | "declined" | "pending" {
  if (d.verified_at) return "verified";
  return d.verify_note ? "declined" : "pending";
}

/** Days until an expiry, for the HR list: negative once expired. */
export function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Expired ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "Expires today";
  return `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}
