import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// Subtask checklist, hidden subtasks and grouped cards on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "ts-founder@hardcode.local";
const LEAD = "ts-lead@hardcode.local";
const A = "ts-a@hardcode.local";
const B = "ts-b@hardcode.local";
const PARENT = "ZZ Set up the lab";
const FIRST = "ZZ Wire the board";
const SECOND = "ZZ Label the cables";
const GROUP = "ZZ Tidy the bench";

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
    ('${B}', 'ZZ Bina', 'member', '{workshop}')`);
  for (const email of [FOUNDER, LEAD, A, B]) createPasswordUser(email, PASSWORD);
  for (const email of [LEAD, A, B, FOUNDER]) await (await signedIn(browser, email)).context().close();
});

test("a lead adds steps to a task from the checklist, and is warned when one is due after the task", async ({ browser }) => {
  const page = await signedIn(browser, LEAD);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title").fill(PARENT);
  await page.getByLabel("Assign to").click();
  await page.getByRole("option", { name: "ZZ Anil" }).click();
  await page.getByLabel("Department").click();
  await page.getByRole("option", { name: "Workshop" }).click();
  await pickDate(page, "Deadline", "2099-01-15");
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);

  const add = page.getByRole("form", { name: "Add a subtask" });
  await add.getByLabel("Subtask name").fill(FIRST);
  await add.getByRole("combobox").click();
  await page.getByRole("option", { name: "ZZ Anil" }).click();
  await add.getByLabel("Subtask due date").fill("2098-12-01");
  await expect(add.getByText("This is due after the main task")).toBeHidden();
  await add.getByRole("button", { name: "Add to subtasks" }).click();
  await expect(page.getByRole("link", { name: FIRST })).toBeVisible();
  await expect(add.getByLabel("Subtask name")).toHaveValue("");

  await add.getByLabel("Subtask name").fill(SECOND);
  await add.getByLabel("Subtask due date").fill("2099-02-01");
  await expect(add.getByText("This is due after the main task")).toBeVisible();
  await add.getByRole("button", { name: "Add to subtasks" }).click();
  await expect(page.getByRole("link", { name: SECOND })).toBeVisible();
  await expect(page.getByRole("list", { name: "Subtasks" }).getByText("Due after the main task")).toBeVisible();

  expect(sql(`select count(*) || ':' || count(distinct assignee_id) from ops.task where parent_task_id = (select id from ops.task where title = '${PARENT}')`)).toBe("2:1");
  await expect(page.getByText("0 of 2 done")).toBeVisible();
});

test("ticking a step finishes it, unticking reopens it, and the progress follows", async ({ browser }) => {
  const page = await signedIn(browser, LEAD);
  const parentId = sql(`select id from ops.task where title = '${PARENT}'`);
  await page.goto(`/tasks/${parentId}`);

  await page.getByRole("checkbox", { name: `Finish ${FIRST}` }).click();
  await expect.poll(() => sql(`select status from ops.task where title = '${FIRST}'`)).toBe("done");
  await expect(page.getByText("1 of 2 done")).toBeVisible();

  await page.getByRole("checkbox", { name: `Reopen ${FIRST}` }).click();
  await expect.poll(() => sql(`select status from ops.task where title = '${FIRST}'`)).toBe("todo");
  await expect(page.getByText("0 of 2 done")).toBeVisible();
});

test("a step holder sees the task it belongs to and the other steps, read-only", async ({ browser }) => {
  const page = await signedIn(browser, A);
  const subId = sql(`select id from ops.task where title = '${FIRST}'`);
  await page.goto(`/tasks/${subId}`);
  await expect(page.getByRole("heading", { name: FIRST })).toBeVisible();
  await expect(page.getByRole("link", { name: `Part of ${PARENT}` })).toBeVisible();
  const siblings = page.getByRole("list", { name: "Other subtasks" });
  await expect(siblings.getByText(`${FIRST} (this task)`)).toBeVisible();
  await expect(siblings.getByRole("link", { name: SECOND })).toBeVisible();
  await expect(siblings.getByRole("button")).toHaveCount(0);
  await expect(siblings.getByRole("checkbox")).toHaveCount(0);
});

test("subtasks stay out of the table until Show subtasks is on", async ({ browser }) => {
  const page = await signedIn(browser, LEAD);
  await page.goto("/tasks?tab=created&layout=list");
  await expect(page.getByRole("link", { name: PARENT, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: FIRST, exact: true })).toHaveCount(0);

  await page.getByRole("group", { name: "Subtasks" }).getByRole("link", { name: "Shown" }).click();
  await expect(page).toHaveURL(/subtasks=1/);
  await expect(page.getByRole("link", { name: FIRST, exact: true })).toBeVisible();
  await expect(page.getByText("Part of").first()).toBeVisible();

  await page.getByRole("group", { name: "Subtasks" }).getByRole("link", { name: "Hidden" }).click();
  await expect(page.getByRole("link", { name: FIRST, exact: true })).toHaveCount(0);
});

test("a task given to two people is one card for its creator and a Shared card for each person", async ({ browser }) => {
  const lead = await signedIn(browser, LEAD);
  await lead.goto("/tasks");
  await lead.getByRole("button", { name: "New task" }).click();
  await lead.getByLabel("Title").fill(GROUP);
  const dialog = lead.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("combobox", { name: "Assign to" }).click();
  await lead.getByPlaceholder("Unassigned (team queue)").fill("ZZ");
  for (const name of ["ZZ Anil", "ZZ Bina"]) await lead.getByRole("option", { name }).click();
  await lead.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await lead.getByLabel("Department").click();
  await lead.getByRole("option", { name: "No department" }).click();
  await lead.getByRole("combobox", { name: "Category" }).click();
  await lead.getByRole("option", { name: "Internal" }).click();
  await pickDate(lead, "Deadline", "2099-01-15");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect.poll(() => sql(`select count(*) from ops.task where title = '${GROUP}'`)).toBe("2");

  await lead.goto("/tasks?tab=created");
  await expect(lead.getByRole("link", { name: GROUP, exact: true })).toHaveCount(1);
  await expect(lead.getByText("Given to 2 people")).toBeVisible();
  await expect(lead.getByText("0 of 2 done").first()).toBeVisible();

  sql(`
    set session_replication_role = replica;
    update ops.task t set status = 'done', completed_at = now()
      from ops.staff s where s.id = t.assignee_id and t.title = '${GROUP}' and s.email = '${A}';
    set session_replication_role = origin;
  `);
  await lead.reload();
  await expect(lead.getByText("1 of 2 done").first()).toBeVisible();

  const bina = await signedIn(browser, B);
  await bina.goto("/tasks");
  await expect(bina.getByRole("link", { name: GROUP, exact: true })).toHaveCount(1);
  await expect(bina.getByText(/^Shared/)).toBeVisible();
});

test("one subtask can be given to two people, and either one can tick it off", async ({ browser }) => {
  const lead = await signedIn(browser, LEAD);
  const parentId = sql(`select id from ops.task where title = '${PARENT}'`);
  await lead.goto(`/tasks/${parentId}`);
  const add = lead.getByRole("form", { name: "Add a subtask" });
  const SHARED = "ZZ Test the sensors";
  await add.getByLabel("Subtask name").fill(SHARED);
  await add.getByRole("combobox").click();
  await lead.getByPlaceholder("Who does it").fill("ZZ");
  for (const name of ["ZZ Anil", "ZZ Bina"]) await lead.getByRole("option", { name }).click();
  await lead.keyboard.press("Escape");
  await add.getByRole("button", { name: "Add to subtasks" }).click();
  await expect(lead.getByRole("link", { name: SHARED })).toBeVisible();
  await expect(lead.getByText("+1 more")).toBeVisible();
  expect(sql(`select shared || ':' || (select count(*) from ops.task_owner o where o.task_id = t.id) from ops.task t where title = '${SHARED}'`)).toBe("true:2");

  const bina = await signedIn(browser, B);
  const subId = sql(`select id from ops.task where title = '${SHARED}'`);
  await bina.goto(`/tasks/${subId}`);
  await expect(bina.getByRole("heading", { name: SHARED })).toBeVisible();
  await bina.goto(`/tasks/${parentId}`);
  await bina.getByRole("checkbox", { name: new RegExp(SHARED) }).check();
  await expect.poll(() => sql(`select status from ops.task where title = '${SHARED}'`)).toBe("done");
});

test("the Add subtask dialog takes several people and makes one shared subtask", async ({ browser }) => {
  const lead = await signedIn(browser, LEAD);
  const parentId = sql(`select id from ops.task where title = '${PARENT}'`);
  await lead.goto(`/tasks/${parentId}`);
  await lead.getByRole("button", { name: "Add subtask" }).click();
  const dialog = lead.getByRole("dialog", { name: "New subtask" });
  const NAME = "ZZ Calibrate the rig";
  await dialog.getByLabel("Title").fill(NAME);
  await dialog.getByRole("combobox", { name: "Assign to" }).click();
  await dialog.getByPlaceholder("Unassigned (team queue)").fill("ZZ");
  for (const name of ["ZZ Anil", "ZZ Bina"]) await lead.getByRole("option", { name }).click();
  await lead.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("One subtask owned by all 2 people")).toBeVisible();
  await expect(dialog.getByRole("radiogroup", { name: "How it is given" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add subtask" }).click();
  await expect(lead.getByRole("link", { name: NAME })).toBeVisible();
  expect(sql(`select shared || ':' || (select count(*) from ops.task_owner o where o.task_id = t.id) || ':' || (parent_task_id is not null) from ops.task t where title = '${NAME}'`)).toBe("true:2:true");
});
