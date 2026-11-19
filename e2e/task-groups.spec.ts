import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// One task for several people, with no department (0028, D62), on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "tg-founder@hardcode.local";
const LEAD = "tg-lead@hardcode.local";
const A = "tg-a@hardcode.local";
const B = "tg-b@hardcode.local";
const C = "tg-c@hardcode.local";
const TITLE = "ZZ Tidy the demo room";

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
    ('${B}', 'ZZ Bina', 'member', '{sales}'),
    ('${C}', 'ZZ Chetan', 'member', '{outreach}')`);
  for (const email of [FOUNDER, LEAD, A, B, C]) createPasswordUser(email, PASSWORD);
  for (const email of [LEAD, A, B, C, FOUNDER]) await (await signedIn(browser, email)).context().close();
});

test("a lead gives one task to three people with no department", async ({ browser }) => {
  const page = await signedIn(browser, LEAD);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title").fill(TITLE);
  await page.getByLabel("Assign to").click();
  await page.getByRole("option", { name: "ZZ Anil" }).click();
  await page.getByLabel("Department").click();
  await page.getByRole("option", { name: "No department" }).click();
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Internal" }).click();
  await page.getByLabel("Also give it to (optional)").fill("ZZ");
  await page.getByRole("checkbox", { name: "ZZ Bina" }).check();
  await page.getByRole("checkbox", { name: "ZZ Chetan" }).check();
  await pickDate(page, "Deadline", "2099-01-15");
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect.poll(() => sql(`select count(*) from ops.task where title = '${TITLE}'`)).toBe("3");
  expect(sql(`select count(distinct group_id) || ':' || bool_and(department is null) || ':' || bool_and(category = 'internal') || ':' || count(distinct assignee_id) from ops.task where title = '${TITLE}'`)).toBe("1:true:true:3");
});

test("each person sees only their own copy and finishes it on their own", async ({ browser }) => {
  const b = await signedIn(browser, B);
  await b.goto("/tasks");
  await expect(b.getByRole("link", { name: TITLE })).toHaveCount(1);
  const idOfB = sql(`select t.id from ops.task t join ops.staff s on s.id = t.assignee_id where t.title = '${TITLE}' and s.email = '${B}'`);
  await b.goto(`/tasks/${idOfB}`);
  await expect(b.getByText("You can only see your own copy")).toBeVisible();
  await expect(b.getByLabel("Title")).toBeDisabled();
  await b.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => sql(`select status from ops.task where id = '${idOfB}'`)).toBe("doing");
  expect(sql(`select count(*) from ops.task where title = '${TITLE}' and status = 'todo'`)).toBe("2");
});

test("the Cockpit counts the three finished tasks with one late", async ({ browser }) => {
  sql(`
    set session_replication_role = replica;
    update ops.task t set status = 'done', completed_at = now(),
      due_date = case s.email when '${A}' then ops.today_ist() + 3 when '${B}' then ops.today_ist() else ops.today_ist() - 2 end
      from ops.staff s where s.id = t.assignee_id and t.title = '${TITLE}';
    set session_replication_role = origin;
  `);
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/cockpit?view=operations");
  await expect(founder.getByRole("group", { name: "Finished", exact: true })).toContainText("3");
  await expect(founder.getByRole("group", { name: "Finished late", exact: true })).toContainText("1");
});
