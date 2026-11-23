import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// One task owned by several people (0038), on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "sh-founder@hardcode.local";
const LEAD = "sh-lead@hardcode.local";
const A = "sh-a@hardcode.local";
const B = "sh-b@hardcode.local";
const C = "sh-c@hardcode.local";
const TITLE = "ZZ Pack the demo kits";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${LEAD}', 'ZZ Lead', 'dept_lead', '{workshop}'),
    ('${A}', 'ZZ Anil', 'member', '{workshop}'),
    ('${B}', 'ZZ Bina', 'member', '{workshop}'),
    ('${C}', 'ZZ Chetan', 'member', '{workshop}')`);
  for (const email of [FOUNDER, LEAD, A, B, C]) createPasswordUser(email, PASSWORD);
  for (const email of [LEAD, A, B, C, FOUNDER]) await (await signedIn(browser, email)).context().close();
});

test("a lead gives one shared task to two people", async ({ browser }) => {
  const page = await signedIn(browser, LEAD);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(TITLE);
  await dialog.getByRole("combobox", { name: "Assign to" }).click();
  await page.getByPlaceholder("Unassigned (team queue)").fill("ZZ");
  for (const name of ["ZZ Anil", "ZZ Bina"]) await page.getByRole("option", { name }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("Each of the 2 people gets their own task")).toBeVisible();
  await dialog.getByRole("radio", { name: /One shared task/ }).click();
  await expect(dialog.getByText("One task owned by all 2 people")).toBeVisible();
  await pickDate(page, "Deadline", "2099-01-15");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  expect(sql(`select count(*) || ':' || bool_and(shared) from ops.task where title = '${TITLE}'`)).toBe("1:true");
  expect(sql(`select count(*) from ops.task_owner o join ops.task t on t.id = o.task_id where t.title = '${TITLE}'`)).toBe("2");
  await expect(page.getByRole("list", { name: "Owners" }).getByRole("listitem")).toHaveCount(2);
});

test("the lead adds a third owner and takes them off again", async ({ browser }) => {
  const page = await signedIn(browser, LEAD);
  const id = sql(`select id from ops.task where title = '${TITLE}'`);
  await page.goto(`/tasks/${id}`);
  const owners = page.getByRole("list", { name: "Owners" });
  await page.getByRole("combobox", { name: "Add an owner" }).click();
  await page.getByRole("option", { name: "ZZ Chetan" }).click();
  await expect(owners.getByRole("listitem")).toHaveCount(3);
  expect(sql(`select count(*) from ops.task_owner where task_id = '${id}'`)).toBe("3");
  await owners.getByRole("button", { name: "Take ZZ Chetan off this task" }).click();
  await expect(owners.getByRole("listitem")).toHaveCount(2);
  expect(sql(`select count(*) from ops.task_owner where task_id = '${id}'`)).toBe("2");
});

test("the second owner sees it in their list and finishes it for everyone", async ({ browser }) => {
  const id = sql(`select id from ops.task where title = '${TITLE}'`);
  const b = await signedIn(browser, B);
  await b.goto("/tasks?tab=mine");
  await expect(b.getByRole("link", { name: TITLE })).toBeVisible();
  await expect(b.getByRole("link", { name: /ZZ Anil, ZZ Bina/ })).toBeVisible();
  await b.goto(`/tasks/${id}`);
  await b.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => sql(`select status from ops.task where id = '${id}'`)).toBe("doing");
  await b.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => sql(`select status from ops.task where id = '${id}'`)).toBe("done");
  expect(sql(`select s.email from ops.task t join ops.staff s on s.id = t.completed_by where t.id = '${id}'`)).toBe(B);

  const a = await signedIn(browser, A);
  await a.goto(`/tasks/${id}`);
  await expect(a.getByText("Done", { exact: true }).first()).toBeVisible();
});

test("a person who only holds a subtask can read the shared parent but not change it", async ({ browser }) => {
  const parent = sql(`select id from ops.task where title = '${TITLE}'`);
  sql(`
    set session_replication_role = replica;
    insert into ops.task (title, assignee_id, created_by, parent_task_id) select 'ZZ Subtask only', s.id, s.id, '${parent}' from ops.staff s where s.email = '${C}';
    set session_replication_role = origin;
  `);
  const c = await signedIn(browser, C);
  await c.goto(`/tasks/${parent}`);
  await expect(c.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(c.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
});
