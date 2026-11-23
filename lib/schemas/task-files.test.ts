import { describe, expect, it } from "vitest";
import {
  TASK_FILE_MAX_BYTES, TASK_FILE_MIMES, checkTaskFile, finishTaskUploadSchema, isTaskFilePath, prepareTaskUploadSchema,
  resolveTaskFileMime, safeTaskFileName, taskFileMatches, taskFilePath, TASK_FILE_REF,
} from "@/lib/schemas/task-files";

const pad = (v: number[], n = 64) => new Uint8Array([...v, ...new Array(Math.max(0, n - v.length)).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PDF = pad(ascii("%PDF-1.7"));
const GIF = pad(ascii("GIF89a"));
const WEBP = pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);
const zipHead = (entry: string) => pad([0x50, 0x4b, 0x03, 0x04, ...new Array(22).fill(0), entry.length, 0, 0, 0, ...ascii(entry)]);
const TASK = "0b1f6a5e-3c4d-4e5f-8a9b-1c2d3e4f5a6b";
const UUID = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

describe("what is allowed", () => {
  it("lists the eleven types", () => {
    expect(TASK_FILE_MIMES).toHaveLength(11);
    for (const bad of ["image/svg+xml", "application/zip", "video/mp4", "text/html", "application/x-msdownload"]) {
      expect(TASK_FILE_MIMES).not.toContain(bad);
    }
  });
  it("accepts a normal file", () => {
    expect(checkTaskFile({ name: "a.png", size: 1000, type: "image/png" })).toEqual({ ok: true, mime: "image/png", kind: "image" });
    expect(checkTaskFile({ name: "a.pdf", size: 1000, type: "application/pdf" })).toEqual({ ok: true, mime: "application/pdf", kind: "document" });
  });
  it("refuses empty, over 25 MB, and types outside the list", () => {
    expect(checkTaskFile({ name: "a.png", size: 0, type: "image/png" })).toMatchObject({ ok: false });
    expect(checkTaskFile({ name: "a.png", size: TASK_FILE_MAX_BYTES, type: "image/png" })).toMatchObject({ ok: true });
    expect(checkTaskFile({ name: "a.png", size: TASK_FILE_MAX_BYTES + 1, type: "image/png" })).toMatchObject({ ok: false });
    for (const [name, type] of ([["a.svg", "image/svg+xml"], ["a.zip", "application/zip"], ["a.mp4", "video/mp4"], ["a.html", "text/html"], ["a.exe", ""]] as [string, string][])) {
      expect(checkTaskFile({ name, size: 10, type })).toMatchObject({ ok: false });
    }
  });
  it("reads the type from the extension when the browser sends none", () => {
    expect(resolveTaskFileMime("notes.md", "")).toBe("text/markdown");
    expect(resolveTaskFileMime("data.CSV", "application/vnd.ms-excel")).toBe("text/csv");
    expect(resolveTaskFileMime("sheet.xlsx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(resolveTaskFileMime("a.md", "text/x-markdown")).toBe("text/markdown");
  });
  it("does not let an extension override a type that is on the list, or rescue one that is not", () => {
    expect(resolveTaskFileMime("a.pdf", "image/png")).toBe("image/png");
    expect(resolveTaskFileMime("a.png", "image/svg+xml")).toBeNull();
    expect(resolveTaskFileMime("a.png", "application/zip")).toBeNull();
    expect(resolveTaskFileMime("noext", "")).toBeNull();
  });
});

describe("the real bytes", () => {
  it("recognises images and PDF by their magic numbers", () => {
    expect(taskFileMatches("image/png", PNG)).toBe(true);
    expect(taskFileMatches("image/jpeg", JPG)).toBe(true);
    expect(taskFileMatches("image/gif", GIF)).toBe(true);
    expect(taskFileMatches("image/webp", WEBP)).toBe(true);
    expect(taskFileMatches("application/pdf", PDF)).toBe(true);
  });
  it("refuses a file that is not what it claims", () => {
    expect(taskFileMatches("image/png", JPG)).toBe(false);
    expect(taskFileMatches("application/pdf", PNG)).toBe(false);
    expect(taskFileMatches("image/gif", PNG)).toBe(false);
    expect(taskFileMatches("image/webp", pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]))).toBe(false);
    expect(taskFileMatches("image/png", pad(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")))).toBe(false);
    expect(taskFileMatches("application/pdf", pad([0x4d, 0x5a, 0x90]))).toBe(false);
  });
  it("accepts Office packages and refuses other zips and non-zips", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(taskFileMatches(docx, zipHead("[Content_Types].xml"))).toBe(true);
    expect(taskFileMatches(docx, zipHead("word/document.xml"))).toBe(true);
    expect(taskFileMatches(docx, zipHead("payload.exe"))).toBe(false);
    expect(taskFileMatches(docx, zipHead("../evil"))).toBe(false);
    expect(taskFileMatches(docx, PDF)).toBe(false);
    expect(taskFileMatches(docx, new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });
  it("accepts text and refuses binary posing as text", () => {
    expect(taskFileMatches("text/plain", new TextEncoder().encode("hello, नमस्ते\nworld"))).toBe(true);
    expect(taskFileMatches("text/csv", new TextEncoder().encode("a,b\n1,2\n"))).toBe(true);
    expect(taskFileMatches("text/markdown", new TextEncoder().encode("# Title\n"))).toBe(true);
    expect(taskFileMatches("text/plain", PNG)).toBe(false);
    expect(taskFileMatches("text/plain", new Uint8Array(0))).toBe(false);
    expect(taskFileMatches("text/csv", new Uint8Array([0xff, 0xfe, 0xfd, 0x80]))).toBe(false);
  });
  it("tolerates a multi-byte character cut at the end of the sample", () => {
    const cut = new TextEncoder().encode("abcdef नमस्ते").slice(0, -2);
    expect(taskFileMatches("text/plain", cut)).toBe(true);
  });
});

describe("names and paths", () => {
  it("makes a storage-safe name that keeps the right extension", () => {
    expect(safeTaskFileName("../../etc/passwd.pdf", "application/pdf")).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/);
    expect(safeTaskFileName("../../etc/passwd.pdf", "application/pdf")).not.toContain("..");
    expect(safeTaskFileName("Résumé final (2).PDF", "application/pdf")).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(safeTaskFileName("photo.JPEG", "image/jpeg")).toBe("photo.jpeg");
    expect(safeTaskFileName("notes", "text/markdown")).toBe("notes.md");
    expect(safeTaskFileName("...", "image/png")).toBe("file.png");
    expect(safeTaskFileName("scan.exe", "application/pdf")).toBe("scan.pdf");
    expect(safeTaskFileName(`${"a".repeat(200)}.pdf`, "application/pdf").length).toBeLessThanOrEqual(64);
  });
  it("builds a path in the task's own folder", () => {
    const p = taskFilePath(TASK, "image/png", "My Photo.png", UUID);
    expect(p).toBe(`${TASK}/${UUID}/My-Photo.png`);
    expect(isTaskFilePath(p, TASK)).toBe(true);
    expect(isTaskFilePath(p, UUID)).toBe(false);
    expect(isTaskFilePath(`${TASK}/${UUID}/..`, TASK)).toBe(false);
    expect(isTaskFilePath(`${TASK}/${UUID}/a b.png`, TASK)).toBe(false);
    expect(isTaskFilePath(`${TASK}/a.png`, TASK)).toBe(false);
    expect(isTaskFilePath(`${TASK}/${UUID}/a.png/../b.png`, TASK)).toBe(false);
  });
  it("recognises an inline image reference", () => {
    expect(TASK_FILE_REF.exec(`task-file:${UUID}`)?.[1]).toBe(UUID);
    expect(TASK_FILE_REF.test("task-file:nope")).toBe(false);
    expect(TASK_FILE_REF.test("https://x/y.png")).toBe(false);
  });
});

describe("the inputs", () => {
  it("checks a prepare request", () => {
    expect(prepareTaskUploadSchema.safeParse({ task_id: TASK, name: "a.png", mime: "image/png", size: 10 }).success).toBe(true);
    expect(prepareTaskUploadSchema.safeParse({ task_id: "x", name: "a.png", mime: "image/png", size: 10 }).success).toBe(false);
    expect(prepareTaskUploadSchema.safeParse({ task_id: TASK, name: "a.png", mime: "image/png", size: 0 }).success).toBe(false);
    expect(prepareTaskUploadSchema.safeParse({ task_id: TASK, name: "a.png", mime: "image/png", size: TASK_FILE_MAX_BYTES + 1 }).success).toBe(false);
    expect(prepareTaskUploadSchema.safeParse({ task_id: TASK, name: "  ", mime: "image/png", size: 10 }).success).toBe(false);
  });
  it("checks a finish request", () => {
    const ok = { task_id: TASK, path: `${TASK}/${UUID}/a.png`, name: "a.png", mime: "image/png" };
    expect(finishTaskUploadSchema.safeParse(ok).success).toBe(true);
    expect(finishTaskUploadSchema.safeParse({ ...ok, comment_id: UUID, inline: true }).success).toBe(true);
    expect(finishTaskUploadSchema.safeParse({ ...ok, comment_id: "nope" }).success).toBe(false);
  });
});
