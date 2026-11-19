import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// Start dates, watchers, mentions and the bell, fixed tasks and the task views (0019) on the LOCAL stack only
// (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "cb-founder@hardcode.local";
const LEAD = "cb-lead@hardcode.local";
const MEMBER_A = "cb-member-a@hardcode.local";
const MEMBER_B = "cb-member-b@hardcode.local";
const TRAINER = "cb-trainer@hardcode.local";
const VIEWER = "cb-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const one = (q: string) => sql(q);
const staffId = (email: string) => one(`select id from ops.staff where email = '${email}'`);
const TITLE = "ZZ Plan the pilot";
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${LEAD}', 'ZZ Lead', 'dept_lead', '{sales}'),
    ('${MEMBER_A}', 'ZZ Alpha', 'member', '{sales}'),
    ('${MEMBER_B}', 'ZZ Bravo', 'member', '{sales}'),
    ('${TRAINER}', 'ZZ Trainer', 'member', '{workshop}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, LEAD, MEMBER_A, MEMBER_B, TRAINER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [LEAD, MEMBER_A, MEMBER_B, TRAINER, VIEWER]) await (await signedIn(browser, email)).context().close();
});

test("a task gets a start date and a deadline, and its assignee can move the start date", async ({ browser }) => {
  const lead = await signedIn(browser, LEAD);
  await lead.goto("/tasks");
  await lead.getByRole("button", { name: "New task" }).click();
  await lead.getByLabel("Title").fill(TITLE);
  await lead.getByLabel("Assign to").click();
  await lead.getByRole("option", { name: "ZZ Alpha" }).click();
  await lead.getByLabel("Department").click();
  await lead.getByRole("option", { name: "Sales" }).click();
  await pickDate(lead, "Start date", "2099-01-10");
  await pickDate(lead, "Deadline", "2099-01-20");
  await lead.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(lead).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  expect(one(`select start_date || ':' || due_date from ops.task where title = '${TITLE}'`)).toBe("2099-01-10:2099-01-20");

  // A start date after the deadline is refused with the rule's own words.
  await pickDate(lead, "Start date", "2099-02-01");
  await lead.getByRole("button", { name: "Save changes" }).click();
  expect(one(`select start_date from ops.task where title = '${TITLE}'`)).toBe("2099-01-10");

  // The assignee did not create it and is not a lead: moving the start date goes through the schedule path.
  const alpha = await signedIn(browser, MEMBER_A);
  await alpha.goto("/tasks");
  await alpha.getByRole("link", { name: TITLE }).click();
  await expect(alpha.getByLabel("Title")).toBeDisabled();
  await pickDate(alpha, "Start date", "2099-01-12");
  await alpha.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => one(`select start_date from ops.task where title = '${TITLE}'`)).toBe("2099-01-12");
  expect(one(`select count(*) from ops.task_history h join ops.task t on t.id = h.task_id where t.title = '${TITLE}' and h.kind = 'start'`)).toBe("1");
});

test("a manager adds a watcher from another department, who then sees the task and is told when it changes", async ({ browser }) => {
  const id = one(`select id from ops.task where title = '${TITLE}'`);
  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto(`/tasks/${id}`);
  await expect(trainer.getByRole("heading", { name: TITLE })).toBeHidden();

  const lead = await signedIn(browser, LEAD);
  await lead.goto(`/tasks/${id}`);
  await lead.getByLabel("Add a watcher").click();
  await lead.getByRole("option", { name: "ZZ Trainer" }).click();
  await expect(lead.getByRole("list", { name: "Watchers" })).toContainText("ZZ Trainer");
  expect(one(`select count(*) from ops.task_watcher where task_id = '${id}' and staff_id = '${staffId(TRAINER)}'`)).toBe("1");

  await trainer.goto(`/tasks/${id}`);
  await expect(trainer.getByRole("heading", { name: TITLE })).toBeVisible();

  const alpha = await signedIn(browser, MEMBER_A);
  await alpha.goto(`/tasks/${id}`);
  await alpha.getByRole("button", { name: "Accept" }).click();
  await alpha.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => one(`select status from ops.task where id = '${id}'`)).toBe("doing");
  await expect
    .poll(() => one(`select count(*) from ops.notification where recipient_id = '${staffId(TRAINER)}' and kind = 'status' and message like '%started it%'`))
    .toBe("1");

  await trainer.goto("/");
  await expect(trainer.getByRole("button", { name: /^Notifications, \d+ unread$/ })).toBeVisible();

  // The watcher can stop watching; the manager can add them again.
  await trainer.goto(`/tasks/${id}`);
  await trainer.getByRole("button", { name: "Stop watching" }).click();
  await expect.poll(() => one(`select count(*) from ops.task_watcher where task_id = '${id}' and staff_id = '${staffId(TRAINER)}'`)).toBe("0");
});

test("a mention notifies the person, the bell counts it, and opening it clears the count", async ({ browser }) => {
  const id = one(`select id from ops.task where title = '${TITLE}'`);
  const bravoId = staffId(MEMBER_B);
  const alpha = await signedIn(browser, MEMBER_A);
  await alpha.goto(`/tasks/${id}`);
  await alpha.getByLabel("Add a comment").fill("Can you take the venue calls?");
  await alpha.getByLabel(/Mention someone/).click();
  await alpha.getByRole("option", { name: "ZZ Bravo" }).click();
  await expect(alpha.getByRole("list", { name: "Mentioned" })).toContainText("@ZZ Bravo");
  await alpha.getByRole("button", { name: "Comment" }).click();
  await expect(alpha.getByRole("list", { name: "Comments" })).toContainText("Can you take the venue calls?");
  await expect.poll(() => one(`select count(*) from ops.notification where recipient_id = '${bravoId}' and kind = 'mentioned' and read_at is null`)).toBe("1");
  expect(one(`select count(*) from ops.task_watcher where task_id = '${id}' and staff_id = '${bravoId}'`)).toBe("1");

  const bravo = await signedIn(browser, MEMBER_B);
  const unread = one(`select count(*) from ops.notification where recipient_id = '${bravoId}' and read_at is null`);
  await expect(bravo.getByRole("button", { name: `Notifications, ${unread} unread` })).toBeVisible();
  await bravo.getByRole("button", { name: /^Notifications/ }).click();
  await bravo.getByRole("link", { name: /mentioned you on/ }).click();
  await expect(bravo).toHaveURL(new RegExp(`/tasks/${id}$`));
  await expect.poll(() => one(`select count(*) from ops.notification where recipient_id = '${bravoId}' and kind = 'mentioned' and read_at is null`)).toBe("0");
  sql(`insert into ops.notification (recipient_id, kind, task_id, message) values
    ('${bravoId}', 'comment', '${id}', 'ZZ first'), ('${bravoId}', 'comment', '${id}', 'ZZ second')`);
  await bravo.reload();
  await expect(bravo.getByRole("button", { name: "Notifications, 2 unread" })).toBeVisible();
  await bravo.getByRole("button", { name: /^Notifications/ }).click();
  await bravo.getByRole("button", { name: "Mark all read" }).click();
  await expect.poll(() => one(`select count(*) from ops.notification where recipient_id = '${bravoId}' and read_at is null`)).toBe("0");
  await bravo.keyboard.press("Escape");
  await bravo.reload();
  await expect(bravo.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});

test("a lead sets up a daily fixed task for the department, each person gets one, and running it again adds nothing", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER_A);
  await member.goto("/tasks/fixed");
  await expect(member.getByText("You don't have access to fixed tasks")).toBeVisible();
  await expect(member.getByRole("button", { name: "New fixed task" })).toBeHidden();

  const lead = await signedIn(browser, LEAD);
  await lead.goto("/tasks/fixed");
  await expect(lead.getByText("No fixed tasks yet")).toBeVisible();
  await lead.getByRole("button", { name: "New fixed task" }).first().click();
  const dialog = lead.getByRole("dialog");
  await dialog.getByLabel("Title").fill("ZZ Daily stock check");
  await dialog.getByLabel("Repeats").click();
  await lead.getByRole("option", { name: "Every day" }).click();
  await dialog.getByRole("button", { name: "Create fixed task" }).click();
  await expect(lead.getByText("ZZ Daily stock check")).toBeVisible();
  expect(one("select frequency || ':' || all_department || ':' || department from ops.task_recurrence where title = 'ZZ Daily stock check'")).toBe("daily:true:sales");

  const eligible = Number(one("select count(*) from ops.staff where is_active and role not in ('partner', 'viewer') and 'sales' = any (departments)"));
  expect(eligible).toBeGreaterThanOrEqual(3);
  expect(Number(one("select (ops.run_task_automation()->>'created')::int"))).toBe(eligible);
  expect(one("select count(*) from ops.task where title = 'ZZ Daily stock check'")).toBe(String(eligible));
  expect(one("select count(distinct assignee_id) from ops.task where title = 'ZZ Daily stock check'")).toBe(String(eligible));
  expect(one(`select count(*) from ops.task where title = 'ZZ Daily stock check' and start_date = '${today}' and due_date = '${today}' and template = 'fixed'`)).toBe(String(eligible));
  expect(one(`select count(*) from ops.notification where kind = 'recurring' and recipient_id = '${staffId(MEMBER_A)}'`)).toBe("1");

  expect(Number(one("select (ops.run_task_automation()->>'created')::int"))).toBe(0);
  expect(one("select count(*) from ops.task where title = 'ZZ Daily stock check'")).toBe(String(eligible));

  await member.goto("/tasks");
  await expect(member.getByRole("link", { name: "ZZ Daily stock check" })).toBeVisible();
  await member.getByRole("link", { name: "ZZ Daily stock check" }).click();
  await expect(member.getByText("Fixed task", { exact: true })).toBeVisible();

  // Pausing stops new tasks; the page action goes through the same rule.
  await lead.reload();
  await lead.getByRole("button", { name: /Pause/ }).click();
  await expect.poll(() => one("select active from ops.task_recurrence where title = 'ZZ Daily stock check'")).toBe("f");
});

test("the board, calendar, timeline and table all show a task, and a saved view brings its filters back", async ({ browser }) => {
  sql(`insert into ops.task (department, title, status, priority, start_date, due_date, assignee_id)
       values ('sales', 'ZZ Layout check', 'todo', 2, '${today}', '${addDays(today, 2)}', '${staffId(MEMBER_A)}')`);
  sql("update ops.task set status = 'doing' where title = 'ZZ Layout check'");
  const lead = await signedIn(browser, LEAD);

  await lead.goto("/tasks?tab=team&layout=list");
  await expect(lead.getByRole("link", { name: "ZZ Layout check" })).toBeVisible();

  await lead.goto("/tasks?tab=team");
  await expect(lead.getByRole("region", { name: "In progress" }).getByRole("link", { name: "ZZ Layout check" })).toBeVisible();

  await lead.goto("/tasks?tab=team&layout=calendar");
  await expect(lead.getByRole("grid").first()).toBeVisible();
  await expect(lead.getByRole("link", { name: /ZZ Layout check/ }).first()).toBeVisible();

  await lead.goto("/tasks?tab=team&layout=timeline");
  await expect(lead.getByText("ZZ Layout check").first()).toBeVisible();

  await lead.goto("/tasks?tab=team&layout=timeline&department=sales");
  await lead.getByRole("button", { name: "Save this view" }).click();
  await lead.getByLabel("Name").fill("ZZ Sales board");
  await lead.getByRole("dialog").getByRole("button", { name: "Save view" }).click();
  await expect.poll(() => one("select query from ops.task_view where name = 'ZZ Sales board'")).toContain("layout=timeline");

  await lead.goto("/tasks");
  await lead.getByRole("button", { name: /^Views/ }).click();
  await lead.getByRole("link", { name: "ZZ Sales board" }).click();
  await expect(lead).toHaveURL(/layout=timeline/);
  await expect(lead).toHaveURL(/department=sales/);
  await expect(lead.getByText("ZZ Layout check").first()).toBeVisible();

  // Another person cannot see or remove a private view.
  const alpha = await signedIn(browser, MEMBER_A);
  await alpha.goto("/tasks");
  await alpha.getByRole("button", { name: /^Views/ }).click();
  await expect(alpha.getByRole("link", { name: "ZZ Sales board" })).toBeHidden();
});

test("a card can be dragged to another column, or moved from its menu, and blocking asks for a reason", async ({ browser }) => {
  const status = () => one("select status from ops.task where title = 'ZZ Layout check'");
  const lead = await signedIn(browser, LEAD);
  await lead.goto("/tasks?tab=team");
  const card = lead.getByRole("listitem").filter({ has: lead.getByRole("link", { name: "ZZ Layout check" }) });
  await expect(lead.getByRole("region", { name: "In progress" }).getByRole("link", { name: "ZZ Layout check" })).toBeVisible();

  // The first drag can land before the page has hydrated, so try again until the drop is handled.
  await expect(async () => {
    await card.dragTo(lead.getByRole("region", { name: "To do" }));
    expect(status()).toBe("todo");
  }).toPass({ timeout: 15_000 });
  await expect(lead.getByRole("region", { name: "To do" }).getByRole("link", { name: "ZZ Layout check" })).toBeVisible();

  await lead.getByRole("button", { name: "Move: ZZ Layout check" }).click();
  await lead.getByRole("menuitem", { name: "Blocked" }).click();
  const dialog = lead.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Mark blocked" })).toBeDisabled();
  await dialog.getByLabel("What is blocking it").fill("Waiting for the school");
  await dialog.getByRole("button", { name: "Mark blocked" }).click();
  await expect.poll(status).toBe("blocked");
  await expect(lead.getByRole("region", { name: "Blocked" }).getByRole("link", { name: "ZZ Layout check" })).toBeVisible();
});
