import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// Task collaboration on the LOCAL stack only (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "tk-founder@hardcode.local";
const SELLER = "tk-sales@hardcode.local";
const TRAINER = "tk-trainer@hardcode.local";
const VIEWER = "tk-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const one = (q: string) => sql(q);
const TITLE = "ZZ Prepare the demo kit";

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${SELLER}', 'ZZ Seller', 'member', '{sales}'),
    ('${TRAINER}', 'ZZ Trainer', 'member', '{workshop}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, SELLER, TRAINER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [SELLER, TRAINER, VIEWER]) await (await signedIn(browser, email)).context().close();
});

test("a Sales member creates a task and assigns it to a Workshop colleague", async ({ browser }) => {
  const page = await signedIn(browser, SELLER);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title").fill(TITLE);
  await page.getByLabel("Details (optional)").fill("Pack two boards and the cables");
  await page.getByLabel("Assign to").click();
  await page.getByRole("option", { name: "ZZ Trainer" }).click();
  await page.getByLabel("Department").click();
  await page.getByRole("option", { name: "Workshop" }).click();
  await pickDate(page, "Deadline", "2099-01-15");
  await page.getByLabel("Deadline time (India)").click();
  await page.getByRole("option", { name: "10:30 am" }).click();
  await page.getByLabel("Priority").click();
  await page.getByRole("option", { name: "High" }).click();
  await page.getByLabel("Estimate (minutes)").fill("90");
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  expect(one(`select s.full_name || ':' || t.priority || ':' || t.estimate_minutes || ':' || t.due_time from ops.task t join ops.staff s on s.id = t.assignee_id where t.title = '${TITLE}'`)).toBe("ZZ Trainer:2:90:10:30:00");
  expect(one(`select count(*) from ops.task_history h join ops.task t on t.id = h.task_id where t.title = '${TITLE}'`)).toBe("2");
  await expect(page.getByRole("list", { name: "History" }).or(page.getByRole("list", { name: "History" }))).toContainText("assigned it to ZZ Trainer");
});

test("the assignee sees it, accepts it, comments, and the creator sees the comment", async ({ browser }) => {
  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto("/tasks");
  await trainer.getByRole("link", { name: TITLE }).click();
  await expect(trainer.getByText("(not accepted yet)")).toBeVisible();
  await trainer.getByRole("button", { name: "Accept" }).click();
  await expect(trainer.getByText(/\(accepted /)).toBeVisible();
  await trainer.getByLabel("Add a comment").fill("On it, boards are in the cupboard");
  await trainer.getByRole("button", { name: "Comment" }).click();
  await expect(trainer.getByText("On it, boards are in the cupboard")).toBeVisible();
  await expect(trainer.getByLabel("Title")).toBeDisabled();

  const seller = await signedIn(browser, SELLER);
  await seller.goto("/tasks?tab=created");
  await seller.getByRole("link", { name: TITLE }).click();
  await expect(seller.getByText("On it, boards are in the cupboard")).toBeVisible();
  await expect(seller.getByLabel("Title")).toBeEnabled();
});

test("blocked and cancelled need a reason, and the reason is shown", async ({ browser }) => {
  const id = one(`select id from ops.task where title = '${TITLE}'`);
  const page = await signedIn(browser, TRAINER);
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => one(`select status from ops.task where id = '${id}'`)).toBe("doing");
  await page.getByRole("button", { name: "Blocked" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark blocked" }).click();
  await expect(page.getByText("Say what is blocking the task.")).toBeVisible();
  expect(one(`select status from ops.task where id = '${id}'`)).toBe("doing");
  await page.getByLabel("Blocked because").fill("Waiting for cables");
  await page.getByRole("dialog").getByRole("button", { name: "Mark blocked" }).click();
  await expect.poll(() => one(`select status || ':' || blocked_reason from ops.task where id = '${id}'`)).toBe("blocked:Waiting for cables");
  await expect(page.getByRole("alert").filter({ hasText: "Waiting for cables" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Unblock" }).click();
  await expect.poll(() => one(`select status || ':' || coalesce(blocked_reason, 'none') from ops.task where id = '${id}'`)).toBe("doing:none");
});

test("subtasks must be finished before the parent, then the parent can be finished and the finisher can reopen it", async ({ browser }) => {
  const id = one(`select id from ops.task where title = '${TITLE}'`);
  const page = await signedIn(browser, TRAINER);
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Add subtask" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("ZZ Count the cables");
  await page.getByRole("dialog").getByRole("button", { name: "Add subtask" }).click();
  await expect(page.getByRole("link", { name: "ZZ Count the cables" })).toBeVisible();
  expect(one(`select count(*) from ops.task where parent_task_id = '${id}'`)).toBe("1");

  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => one(`select status from ops.task where id = '${id}'`)).toBe("doing");
  await expect(page.getByText(/subtasks first/i).first()).toBeVisible();

  await page.getByRole("link", { name: "ZZ Count the cables" }).click();
  await expect(page.getByRole("heading", { name: "ZZ Count the cables" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => one("select status from ops.task where title = 'ZZ Count the cables'")).toBe("done");

  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => one(`select status from ops.task where id = '${id}'`)).toBe("done");
  expect(one(`select s.full_name from ops.task t join ops.staff s on s.id = t.completed_by where t.id = '${id}'`)).toBe("ZZ Trainer");
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect.poll(() => one(`select status from ops.task where id = '${id}'`)).toBe("todo");
});

test("an assignee cannot hand the task to someone else, but can hand it back to the queue, where a colleague claims it", async ({ browser }) => {
  const id = one(`select id from ops.task where title = '${TITLE}'`);
  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto(`/tasks/${id}`);
  await expect(trainer.getByLabel("Assign to")).toBeHidden();
  await expect(trainer.getByText(/Only the person who assigned this task/)).toBeVisible();
  await trainer.getByRole("button", { name: "Hand back" }).click();
  await expect.poll(() => one(`select coalesce(assignee_id::text, 'none') from ops.task where id = '${id}'`)).toBe("none");

  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/tasks?tab=team&assignee=none");
  await expect(founder.getByRole("link", { name: TITLE })).toBeVisible();
  await founder.getByRole("link", { name: TITLE }).click();
  await founder.getByRole("button", { name: "Take it" }).click();
  await expect.poll(() => one(`select s.full_name from ops.task t join ops.staff s on s.id = t.assignee_id where t.id = '${id}'`)).toBe("Local Founder");
});

test("a viewer can read tasks but cannot create or change them", async ({ browser }) => {
  sql(`update ops.task set assignee_id = null, department = 'sales' where title = '${TITLE}'`);
  const page = await signedIn(browser, VIEWER);
  await page.goto("/tasks?tab=team");
  await expect(page.getByRole("button", { name: "New task" })).toBeHidden();
  await page.getByRole("link", { name: TITLE }).click();
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
  await expect(page.getByLabel("Add a comment")).toBeHidden();
});
