import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES, checkUpload, documentStatus, expiryLabel, formatBytes, hrDocumentSchema, ownDocumentSchema, safeFileName, sniffMime,
} from "@/lib/schemas/documents";

const bytes = (...v: number[]) => new Uint8Array([...v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

describe("upload checks", () => {
  it("recognises the four allowed types by their first bytes", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPG)).toBe("image/jpeg");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(bytes(0x4d, 0x5a))).toBeNull();
  });
  it("accepts a real file of the type it claims", () => {
    expect(checkUpload({ size: 1000, type: "application/pdf" }, PDF)).toMatchObject({ ok: true, mime: "application/pdf" });
  });
  it("refuses an empty file, an oversize file and a type outside the list", () => {
    expect(checkUpload({ size: 0, type: "application/pdf" }, PDF)).toMatchObject({ ok: false });
    expect(checkUpload({ size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" }, PDF)).toMatchObject({ ok: false });
    expect(checkUpload({ size: 10, type: "application/zip" })).toMatchObject({ ok: false });
  });
  it("refuses a file whose bytes do not match its claimed type", () => {
    expect(checkUpload({ size: 1000, type: "application/pdf" }, PNG)).toMatchObject({ ok: false });
  });
  it("makes a storage-safe name", () => {
    expect(safeFileName("../../etc/passwd.pdf", "pdf")).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/);
    expect(safeFileName("../../etc/passwd.pdf", "pdf")).not.toContain("..");
    expect(safeFileName("Résumé final (2).PDF", "pdf")).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(safeFileName("...", "png")).toBe("file.png");
    expect(safeFileName(`${"a".repeat(200)}.pdf`, "pdf").length).toBeLessThanOrEqual(64);
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("document status and expiry", () => {
  it("is verified, declined with a note, or pending", () => {
    expect(documentStatus({ verified_at: "2026-01-01T00:00:00Z", verify_note: null })).toBe("verified");
    expect(documentStatus({ verified_at: null, verify_note: "Blurry" })).toBe("declined");
    expect(documentStatus({ verified_at: null, verify_note: null })).toBe("pending");
  });
  it("words the days left", () => {
    expect(expiryLabel(-1)).toBe("Expired 1 day ago");
    expect(expiryLabel(-5)).toBe("Expired 5 days ago");
    expect(expiryLabel(0)).toBe("Expires today");
    expect(expiryLabel(1)).toBe("Expires in 1 day");
    expect(expiryLabel(30)).toBe("Expires in 30 days");
  });
});

describe("document forms", () => {
  it("treats an empty expiry as none and refuses a badly shaped one", () => {
    expect(ownDocumentSchema.parse({ kind: "id_proof", title: "Passport", expires_on: "" }).expires_on).toBeNull();
    expect(ownDocumentSchema.safeParse({ kind: "id_proof", title: "Passport", expires_on: "31/03/2027" }).success).toBe(false);
  });
  it("needs a title; people cannot upload a payslip for themselves; HR uploads need a person", () => {
    expect(ownDocumentSchema.safeParse({ kind: "id_proof", title: "  ", expires_on: "" }).success).toBe(false);
    expect(ownDocumentSchema.safeParse({ kind: "payslip", title: "x", expires_on: "" }).success).toBe(false);
    expect(hrDocumentSchema.safeParse({ staff_id: "nope", kind: "payslip", title: "x", expires_on: "" }).success).toBe(false);
  });
});
