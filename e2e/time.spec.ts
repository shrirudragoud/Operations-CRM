import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Timer, manual time, timesheet, My day, task health and workload (0020) on the LOCAL stack only
// (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "tm-founder@hardcode.local";
const LEAD = "tm-lead@hardcode.local";
const MEMBER = "tm-member@hardcode.local";
const VIEWER = "tm-viewer@hardcode.local";
const PARTNER = "tm-partner@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const one = (q: string) => sql(q);
const staffId = (email: string) => one(`select id from ops.staff where email = '${email}'`);
const taskId = (title: string) => one(`select id from ops.task where title = '${title}'`);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const T1 = "ZZ Write report";
const T2 = "ZZ Fix the demo";
const T3 = "ZZ Ship the kit";

function seedTask(title: string, extra: { estimate?: number; start?: string; due?: string } = {}) {
  sql(`insert into ops.task (department, title, status, priority, estimate_minutes, start_date, due_date, assignee_id)
       values ('sales', '${title}', 'todo', 2, ${extra.estimate ?? "null"}, ${extra.start ? `'${extra.start}'` : "null"},
               ${extra.due ? `'${extra.due}'` : "null"}, '${staffId(MEMBER)}')`);
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${LEAD}', 'ZZ Lead', 'dept_lead', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{sales}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}'),
    ('${PARTNER}', 'ZZ Partner', 'partner', '{}')`);
  for (const email of [FOUNDER, LEAD, MEMBER, VIEWER, PARTNER]) createPasswordUser(email, PASSWORD);
  for (const email of [LEAD, MEMBER, VIEWER, PARTNER]) await (await signedIn(browser, email)).context().close();
  seedTask(T1, { estimate: 120 });
  seedTask(T2);
  seedTask(T3);
});

test("one timer at a time: starting a second stops the first, and the chip stops it", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER);
  await member.goto(`/tasks/${taskId(T1)}`);
  await member.getByRole("button", { name: "Start timer" }).click();
  await expect(member.getByRole("status", { name: `Timer running on ${T1}` })).toBeVisible();
  expect(one(`select count(*) from ops.time_entry where task_id = '${taskId(T1)}' and ended_at is null`)).toBe("1");

  await member.goto(`/tasks/${taskId(T2)}`);
  await expect(member.getByText(`A timer is running on ${T1}`)).toBeVisible();
  await member.getByRole("button", { name: "Start timer" }).click();
  await expect(member.getByRole("status", { name: `Timer running on ${T2}` })).toBeVisible();
  expect(one(`select count(*) from ops.time_entry where staff_id = '${staffId(MEMBER)}' and source = 'timer' and ended_at is null`)).toBe("1");
  expect(one(`select count(*) from ops.time_entry where task_id = '${taskId(T2)}' and ended_at is null`)).toBe("1");
  expect(Number(one(`select minutes from ops.time_entry where task_id = '${taskId(T1)}' and source = 'timer'`))).toBeGreaterThanOrEqual(1);

  await member.getByRole("button", { name: `Stop the timer on ${T2}` }).click();
  await expect.poll(() => one(`select count(*) from ops.time_entry where staff_id = '${staffId(MEMBER)}' and ended_at is null`)).toBe("0");
  expect(Number(one(`select minutes from ops.time_entry where task_id = '${taskId(T2)}'`))).toBeGreaterThanOrEqual(1);
});

test("manual time: logged, refused for a future day, and capped at 24 hours a day", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER);
  await member.goto(`/tasks/${taskId(T1)}`);
  const before = Number(one(`select coalesce(sum(minutes), 0) from ops.time_entry where staff_id = '${staffId(MEMBER)}' and work_date = '${today}'`));

  const open = async () => {
    await expect(async () => {
      await member.getByRole("button", { name: "Log time" }).first().click();
      await expect(member.getByRole("dialog").getByLabel("How long")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  };
  const dialog = member.getByRole("dialog");

  await open();
  await dialog.getByLabel("How long").fill("1h 30m");
  await dialog.getByRole("button", { name: "Log time" }).click();
  await expect(dialog).toBeHidden();
  expect(one(`select minutes from ops.time_entry where task_id = '${taskId(T1)}' and source = 'manual' and work_date = '${today}'`)).toBe("90");
  await expect(member.getByRole("list", { name: "Time entries" })).toContainText("1h 30m");

  await open();
  // The day picker refuses a future day before the form is sent.
  await dialog.getByLabel("Day", { exact: true }).click();
  const future = addDays(today, 3).split("-").reverse().join("/");
  await member.getByLabel("Type a date (dd/mm/yyyy)").fill(future);
  await member.getByLabel("Type a date (dd/mm/yyyy)").press("Enter");
  await expect(member.getByRole("alert").filter({ hasText: "allowed days" })).toBeVisible();
  await member.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(one(`select count(*) from ops.time_entry where task_id = '${taskId(T1)}' and work_date > '${today}'`)).toBe("0");

  // Fill the day up to the cap: 90 minutes are already there, so 16h more passes and another 9h does not.
  await open();
  await dialog.getByLabel("How long").fill("16h");
  await dialog.getByRole("button", { name: "Log time" }).click();
  await expect(dialog).toBeHidden();
  await open();
  await dialog.getByLabel("How long").fill("9h");
  await dialog.getByRole("button", { name: "Log time" }).click();
  await expect(dialog.getByRole("alert")).toContainText("more than 24 hours");
  expect(Number(one(`select coalesce(sum(minutes), 0) from ops.time_entry where staff_id = '${staffId(MEMBER)}' and work_date = '${today}'`))).toBe(
    before + 90 + 960,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The person who logged it can delete it.
  const del = member.getByRole("button", { name: /^Delete the / }).first();
  await del.click();
  await expect.poll(() => one(`select count(*) from ops.time_entry where task_id = '${taskId(T1)}' and source = 'manual'`)).toBe("1");
  sql(`delete from ops.time_entry where task_id = '${taskId(T1)}' and source = 'manual'`);
});

test("finishing a task stops the timer that is running on it", async ({ browser }) => {
  sql(`update ops.task set status = 'doing' where title = '${T3}'`);
  const member = await signedIn(browser, MEMBER);
  await member.goto(`/tasks/${taskId(T3)}`);
  await member.getByRole("button", { name: "Start timer" }).click();
  await expect(member.getByRole("status", { name: `Timer running on ${T3}` })).toBeVisible();
  await member.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => one(`select status from ops.task where title = '${T3}'`)).toBe("done");
  expect(one(`select count(*) from ops.time_entry where task_id = '${taskId(T3)}' and ended_at is null`)).toBe("0");
  await expect(member.getByRole("status", { name: /^Timer running on/ })).toBeHidden();
});

test("the timesheet: a member sees and adds their own week, a lead reads a person's, a viewer and a partner cannot track", async ({ browser }) => {
  sql(`insert into ops.time_entry (staff_id, task_id, source, work_date, minutes)
       values ('${staffId(MEMBER)}', '${taskId(T1)}', 'manual', '${today}', 45)`);
  const member = await signedIn(browser, MEMBER);
  await member.goto("/timesheet");
  await expect(member.getByRole("heading", { name: "Timesheet" })).toBeVisible();
  await expect(member.getByRole("row", { name: /^Total/ })).toBeVisible();
  await expect(member.getByRole("button", { name: new RegExp(`on ${T1}, .*\\. Open`) }).first()).toBeVisible();
  await expect(member.getByRole("combobox", { name: "Person" })).toHaveCount(0);

  await expect(async () => {
    await member.getByRole("button", { name: "Add time", exact: true }).click();
    await expect(member.getByRole("dialog")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await member.getByRole("dialog").getByLabel("Task").click();
  await member.getByRole("option", { name: T2 }).click();
  await member.getByRole("dialog").getByLabel("How long").fill("30m");
  await member.getByRole("dialog").getByRole("button", { name: "Log time" }).click();
  await expect.poll(() => one(`select coalesce(sum(minutes), 0) from ops.time_entry where task_id = '${taskId(T2)}' and source = 'manual'`)).toBe("30");

  const lead = await signedIn(browser, LEAD);
  await lead.goto("/timesheet");
  await expect(async () => {
    await lead.getByRole("combobox", { name: "Person" }).click();
    await expect(lead.getByRole("option", { name: "ZZ Member" })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await lead.getByRole("option", { name: "ZZ Member" }).click();
  await expect(lead).toHaveURL(new RegExp(staffId(MEMBER)));
  await expect(lead.getByRole("button", { name: new RegExp(`on ${T1}, .*\\. Open`) }).first()).toBeVisible();
  await expect(lead.getByRole("button", { name: "Add time", exact: true })).toHaveCount(0);

  const viewer = await signedIn(browser, VIEWER);
  await viewer.goto(`/tasks/${taskId(T1)}`);
  await expect(viewer.getByRole("heading", { name: T1 })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Start timer" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Log time" })).toHaveCount(0);
  await viewer.goto("/timesheet");
  await expect(viewer.getByRole("button", { name: "Add time", exact: true })).toHaveCount(0);

  const partner = await signedIn(browser, PARTNER);
  await partner.goto("/timesheet");
  await expect(partner.getByText("You don't have access to the timesheet")).toBeVisible();
});

test("My day groups the work by when it is due and shows its health, and the lead sees the team's workload", async ({ browser }) => {
  seedTask("ZZ Overdue thing", { due: addDays(today, -1) });
  seedTask("ZZ Due today thing", { due: today });
  seedTask("ZZ Soon thing", { start: addDays(today, 2), due: addDays(today, 5) });
  seedTask("ZZ Later thing", { due: addDays(today, 30) });
  seedTask("ZZ Open thing");

  const member = await signedIn(browser, MEMBER);
  await member.goto("/");
  await expect(member.getByRole("heading", { name: /^Hello, ZZ/ })).toBeVisible();
  const group = (label: string) => member.getByRole("list", { name: label });
  await expect(group("Overdue")).toContainText("ZZ Overdue thing");
  await expect(group("Due today")).toContainText("ZZ Due today thing");
  await expect(group("Starting soon / this week")).toContainText("ZZ Soon thing");
  await expect(group("Later")).toContainText("ZZ Later thing");
  await expect(group("Unscheduled")).toContainText("ZZ Open thing");
  await expect(group("Overdue")).not.toContainText("ZZ Later thing");

  await expect(member.getByRole("form", { name: "Daily log" })).toHaveCount(0);
  await expect(group("Overdue")).toContainText("Overdue 1 d");
  await expect(group("Due today")).toContainText("Due today");

  await member.goto("/workload");
  await expect(member.getByText("You don't have access to team workload")).toBeVisible();

  const lead = await signedIn(browser, LEAD);
  await lead.goto("/workload");
  const row = lead.getByRole("row", { name: /ZZ Member/ });
  await expect(row).toBeVisible();
  const open = one(`select count(*) from ops.task where assignee_id = '${staffId(MEMBER)}' and status in ('todo','doing','blocked')`);
  await expect(row.getByRole("cell").nth(1)).toHaveText(open);
  await expect(lead.getByText(/needs? attention/)).toBeVisible();
  await expect(lead.getByText("Recent daily logs")).toHaveCount(0);
});
