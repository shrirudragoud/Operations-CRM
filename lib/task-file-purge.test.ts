import { describe, expect, it } from "vitest";
import { purge } from "../scripts/purge-task-files.mjs";

type Rpc = Record<string, ((args: Record<string, unknown>) => unknown) | undefined>;

function fake(rpcs: Rpc, removeError: string | null = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const removed: string[][] = [];
  const client = {
    schema: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        try {
          return { data: rpcs[name]?.(args), error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    }),
    storage: { from: () => ({ remove: async (paths: string[]) => (removed.push(paths), { error: removeError ? { message: removeError } : null }) }) },
  };
  return { client, calls, removed };
}

const deletableAll = (a: Record<string, unknown>) => a.p_paths;

describe("purge task files", () => {
  it("deletes orphans and stray objects, then acknowledges only the orphans", async () => {
    const f = fake({
      purge_task_attachments: () => ["o1", "o2"],
      list_unregistered_task_objects: () => ["s1", "o2"],
      task_files_deletable: deletableAll,
      ack_task_file_orphans: () => 2,
    });
    const s = await purge(f.client, {});
    expect(f.removed.flat().sort()).toEqual(["o1", "o2", "s1"]);
    expect(s).toMatchObject({ orphans: 2, stray: 1, deleted: 3, kept: 0 });
    expect(f.calls.find((c) => c.name === "ack_task_file_orphans")?.args).toEqual({ p_paths: ["o1", "o2"] });
  });

  it("keeps an object the database says still backs a file", async () => {
    const f = fake({
      purge_task_attachments: () => [],
      list_unregistered_task_objects: () => ["live", "gone"],
      task_files_deletable: (a) => (a.p_paths as string[]).filter((p) => p !== "live"),
      ack_task_file_orphans: () => 0,
    });
    const s = await purge(f.client, {});
    expect(f.removed.flat()).toEqual(["gone"]);
    expect(s.kept).toBe(1);
  });

  it("does not acknowledge a batch that failed to delete, so the next run retries it", async () => {
    const f = fake(
      { purge_task_attachments: () => ["o1"], list_unregistered_task_objects: () => [], task_files_deletable: deletableAll, ack_task_file_orphans: () => 1 },
      "storage is down",
    );
    const s = await purge(f.client, {});
    expect(s.failedBatches).toBe(1);
    expect(s.deleted).toBe(0);
    expect(f.calls.some((c) => c.name === "ack_task_file_orphans")).toBe(false);
  });

  it("acknowledges an orphan that is kept, so it does not come back forever", async () => {
    const f = fake({
      purge_task_attachments: () => ["o1"],
      list_unregistered_task_objects: () => [],
      task_files_deletable: () => [],
      ack_task_file_orphans: () => 1,
    });
    await purge(f.client, {});
    expect(f.removed).toEqual([]);
    expect(f.calls.find((c) => c.name === "ack_task_file_orphans")?.args).toEqual({ p_paths: ["o1"] });
  });

  it("a dry run changes nothing and never calls the purge or the acknowledgement", async () => {
    const f = fake({ list_unregistered_task_objects: () => ["s1"], task_files_deletable: deletableAll });
    const s = await purge(f.client, { dryRun: true });
    expect(f.removed).toEqual([]);
    expect(f.calls.map((c) => c.name)).toEqual(["list_unregistered_task_objects", "task_files_deletable"]);
    expect(s).toMatchObject({ dryRun: true, stray: 1, deleted: 0 });
  });

  it("caps the work per run and deletes in batches of 100", async () => {
    const many = Array.from({ length: 450 }, (_, i) => `p${i}`);
    const f = fake({
      purge_task_attachments: () => [],
      list_unregistered_task_objects: () => many,
      task_files_deletable: deletableAll,
      ack_task_file_orphans: () => 0,
    });
    const s = await purge(f.client, { max: 250 });
    expect(s.deleted).toBe(250);
    expect(f.removed.map((r) => r.length)).toEqual([100, 100, 50]);
  });

  it("asks for stray objects older than the given hours", async () => {
    const f = fake({ purge_task_attachments: () => [], list_unregistered_task_objects: () => [], task_files_deletable: deletableAll, ack_task_file_orphans: () => 0 });
    await purge(f.client, { strayHours: 48, days: 7 });
    expect(f.calls[0]).toEqual({ name: "purge_task_attachments", args: { p_days: 7 } });
    expect(f.calls[1]?.args).toMatchObject({ p_older_than: "48 hours" });
  });

  it("stops with the database's own error message", async () => {
    const f = fake({ purge_task_attachments: () => { throw new Error("Only the scheduled job can purge files"); } });
    await expect(purge(f.client, {})).rejects.toThrow("Only the scheduled job can purge files");
  });
});
