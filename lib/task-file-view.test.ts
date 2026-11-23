import { describe, expect, it } from "vitest";
import { fileByline, fileSummary, fileTypeLabel, splitFilesByComment } from "./task-file-view";

describe("task file view helpers", () => {
  it("labels known types and falls back for unknown ones", () => {
    expect(fileTypeLabel("application/pdf")).toBe("PDF");
    expect(fileTypeLabel("image/png")).toBe("PNG image");
    expect(fileTypeLabel("application/zip")).toBe("File");
  });

  it("summarises type and size", () => {
    expect(fileSummary({ mime: "application/pdf", size_bytes: 2048 })).toBe("PDF, 2 KB");
    expect(fileSummary({ mime: "text/csv", size_bytes: 12 })).toBe("CSV, 12 B");
  });

  it("words the byline with or without an uploader", () => {
    expect(fileByline({ uploader: "Asha", at: "5 Dec 2026" })).toBe("Asha, 5 Dec 2026");
    expect(fileByline({ uploader: null, at: "5 Dec 2026" })).toBe("5 Dec 2026");
  });

  it("splits task files from comment files", () => {
    const files = [
      { id: "a", comment_id: null },
      { id: "b", comment_id: "c1" },
      { id: "c", comment_id: "c1" },
      { id: "d", comment_id: "c2" },
    ];
    const { task, byComment } = splitFilesByComment(files);
    expect(task.map((f) => f.id)).toEqual(["a"]);
    expect(byComment.get("c1")?.map((f) => f.id)).toEqual(["b", "c"]);
    expect(byComment.get("c2")?.map((f) => f.id)).toEqual(["d"]);
  });
});
