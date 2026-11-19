import { test } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Visits every page as the founder so a server started with OPS_TIMING=1 logs its Supabase calls (see scripts/timing-report.mjs).
// Opt-in: E2E_PERF=1 E2E_REUSE=1 E2E_PORT=3111 npx playwright test e2e/perf-pages.spec.ts (server started by hand, local stack only).
test.skip(process.env.E2E_PERF !== "1", "performance walk-through is opt-in");

const FOUNDER = "perf-founder@hardcode.local";
const PASSWORD = "correct-horse-battery";
const PAGES = [
  "/", "/tasks", "/tasks?layout=board", "/tasks?layout=calendar", "/tasks/fixed", "/calendar", "/calendar/series",
  "/institutions", "/outreach", "/sales", "/workshop", "/inventory", "/training", "/product", "/community", "/feedback",
  "/cockpit", "/cockpit?view=operations", "/workload", "/timesheet", "/attendance", "/team", "/audit-log", "/account",
];
const ROUNDS = 3;

test("walk every page as the founder", async ({ page }) => {
  test.setTimeout(300_000);
  resetDatabase(FOUNDER);
  createPasswordUser(FOUNDER, PASSWORD);
  await signInWithPassword(page, FOUNDER, PASSWORD);
  sql(`
    set session_replication_role = replica;
    insert into ops.institution (name, kind, city)
      select 'ZZ Perf ' || g, case when g % 3 = 0 then 'engineering_college' else 'school' end, 'Pune' from generate_series(1, 60) g;
    insert into ops.task (department, title, status, priority, due_date, assignee_id)
      select (array['sales','outreach','workshop','training','product','community'])[1 + g % 6]::ops.department, 'ZZ Perf task ' || g,
             (array['todo','doing','done'])[1 + g % 3], 1 + g % 4, ops.today_ist() + (g % 20) - 10, (select id from ops.staff limit 1)
        from generate_series(1, 80) g;
    set session_replication_role = origin;
  `);
  for (let round = 0; round < ROUNDS; round++) {
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
    }
  }
});
