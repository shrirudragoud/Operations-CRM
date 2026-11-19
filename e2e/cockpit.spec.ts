import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// The Cockpit (0025, D59) on the LOCAL stack only (see playwright.config.ts).
const PASSWORD = "correct-horse-battery";
const FOUNDER = "ck-founder@hardcode.local";
const MEMBER = "ck-member@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values ('${MEMBER}', 'ZZ Member', 'member', '{sales}')`);
  for (const email of [FOUNDER, MEMBER]) createPasswordUser(email, PASSWORD);
  await (await signedIn(browser, MEMBER)).context().close();
  await (await signedIn(browser, FOUNDER)).context().close();

  sql(`
    delete from ops.ide_user_snapshot;
    insert into ops.institution (name, kind, city) values
      ('ZZ Cockpit School A', 'school', 'Pune'), ('ZZ Cockpit School B', 'school', 'Pune'),
      ('ZZ Cockpit College', 'engineering_college', 'Pune');
    update ops.institution set stage = 'contacted' where name = 'ZZ Cockpit School A';
    update ops.institution set stage = 'teachers_trained' where name = 'ZZ Cockpit School B';
    update ops.institution set stage = 'qualified' where name = 'ZZ Cockpit College';
    insert into ops.task (department, title, status, priority, due_date, assignee_id)
      select 'sales', 'ZZ Overdue follow up', 'todo', 1, ops.today_ist() - 4, id from ops.staff where email = '${FOUNDER}';
  `);
});

test("the founder reads the funnel, and students show as not connected", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/cockpit");
  await expect(founder.getByText("Funnel", { exact: true })).toBeVisible();
  await expect(founder.getByRole("img", { name: "Contacted: 3" })).toBeVisible();
  await expect(founder.getByRole("img", { name: "Qualified: 2" })).toBeVisible();
  await expect(founder.getByRole("img", { name: "Teachers trained: 1" })).toBeVisible();
  await expect(founder.getByText("Student steps are not connected")).toBeVisible();

  await founder.getByRole("link", { name: "Schools" }).click();
  await expect(founder.getByRole("img", { name: "Contacted: 2" })).toBeVisible();
  await expect(founder.getByRole("img", { name: "Qualified: 1" })).toBeVisible();

  await founder.getByRole("link", { name: "Teachers trained" }).click();
  await expect(founder).toHaveURL(/\/institutions\?stage=teachers_trained/);
  await expect(founder.getByText("ZZ Cockpit School B")).toBeVisible();
});

test("student steps appear once the IDE has synced", async ({ browser }) => {
  sql(`insert into ops.ide_user_snapshot (ide_user_id, signed_up_at, first_compile_at) values ('zz-ck-1', now(), now()), ('zz-ck-2', now(), null)`);
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/cockpit");
  await expect(founder.getByText("Student steps are not connected")).toHaveCount(0);
  await expect(founder.getByText("Published a project")).toBeVisible();
});

test("the operations view lists what is late, and the job health", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/cockpit?view=operations");
  await expect(founder.getByRole("link", { name: "ZZ Overdue follow up" })).toBeVisible();
  await expect(founder.getByText("Overdue 4 d")).toBeVisible();
  await expect(founder.getByText("Background jobs")).toBeVisible();
  await expect(founder.getByText("Not scheduled yet").first()).toBeVisible();
});

test("the operations view counts finished work, and a lead sees only their team", async ({ browser }) => {
  sql(`
    set session_replication_role = replica;
    insert into ops.task (department, title, status, priority, due_date, assignee_id, completed_at)
      select 'sales', 'ZZ Finished late', 'done', 3, ops.today_ist() - 1, id, now() from ops.staff where email = '${MEMBER}';
    insert into ops.task (department, title, status, priority, due_date, assignee_id, completed_at)
      select 'workshop', 'ZZ Finished workshop', 'done', 3, null, id, now() from ops.staff where email = '${FOUNDER}';
    set session_replication_role = origin;
  `);

  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/cockpit?view=operations");
  await expect(founder.getByRole("group", { name: "Finished", exact: true })).toContainText("2");
  await expect(founder.getByRole("group", { name: "Finished late", exact: true })).toContainText("1");
  await expect(founder.getByRole("group", { name: "On time or early", exact: true })).toContainText("0%");
  await expect(founder.getByRole("figure", { name: "Tasks finished per day" })).toBeVisible();
  await founder.getByRole("link", { name: "Month" }).click();
  await expect(founder).toHaveURL(/period=month/);
  await expect(founder.getByText("Week by week", { exact: true })).toBeVisible();
  await expect(founder.getByRole("button", { name: "Next period" })).toBeDisabled();

  sql(`insert into ops.invite (email, full_name, role, departments) values ('ck-lead@hardcode.local', 'ZZ Lead', 'dept_lead', '{sales}')`);
  createPasswordUser("ck-lead@hardcode.local", PASSWORD);
  const lead = await signedIn(browser, "ck-lead@hardcode.local");
  await lead.goto("/cockpit?view=fundraising");
  await expect(lead.getByRole("link", { name: "Fundraising" })).toHaveCount(0);
  await expect(lead.getByRole("group", { name: "Finished", exact: true })).toContainText("1");
  await expect(lead.getByText("Background jobs")).toHaveCount(0);
  await expect(lead.getByText("Low stock", { exact: true })).toHaveCount(0);
});

test("a member cannot open the Cockpit", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER);
  await member.goto("/cockpit");
  await expect(member.getByText("You don't have access to the Cockpit")).toBeVisible();
});
