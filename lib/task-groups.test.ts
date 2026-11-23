import { describe, expect, it } from "vitest";
import { clusterCopies, clusterHealth, clusterProgress, clusterStatus } from "./task-groups";

const NOW = new Date("2026-11-10T04:30:00Z");

describe("clusterCopies", () => {
  it("folds copies of one group into the place of the first and leaves other rows alone", () => {
    const rows = [
      { id: "a", group_id: "g1", assignee_id: "p1" },
      { id: "b", group_id: null, assignee_id: "p1" },
      { id: "c", group_id: "g1", assignee_id: "p2" },
      { id: "d", group_id: "g2", assignee_id: "p3" },
    ];
    const out = clusterCopies(rows);
    expect(out.map((c) => c.lead.id)).toEqual(["a", "b", "d"]);
    expect(out[0]?.copies.map((c) => c.id)).toEqual(["a", "c"]);
    expect(out[2]?.copies).toHaveLength(1);
  });

  it("leads with the viewer's own copy", () => {
    const rows = [{ id: "a", group_id: "g", assignee_id: "p1" }, { id: "c", group_id: "g", assignee_id: "me" }];
    expect(clusterCopies(rows, "me")[0]?.lead.id).toBe("c");
  });
});

describe("clusterStatus and clusterProgress", () => {
  it("is to do until someone starts, in progress while some are done, done when all live copies are", () => {
    expect(clusterStatus(["todo", "todo"])).toBe("todo");
    expect(clusterStatus(["todo", "doing"])).toBe("doing");
    expect(clusterStatus(["done", "todo"])).toBe("doing");
    expect(clusterStatus(["done", "cancelled"])).toBe("done");
    expect(clusterStatus(["done", "blocked"])).toBe("blocked");
    expect(clusterStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });

  it("counts done out of the copies that are still owed", () => {
    expect(clusterProgress(["done", "todo", "doing", "cancelled"])).toEqual({ done: 1, total: 3 });
  });
});

describe("clusterHealth", () => {
  it("shows the worst copy", () => {
    const h = clusterHealth([
      { status: "doing", due_date: "2026-11-30" },
      { status: "todo", due_date: "2026-11-08" },
      { status: "done", due_date: "2026-11-01" },
    ], NOW);
    expect(h.key).toBe("overdue");
  });
});
