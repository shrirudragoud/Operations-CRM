import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// The calendar shows everything assigned to a person: Workshop days, meetings, tasks, outreach and deals
// (LOCAL stack only, see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "ce-founder@hardcode.local";
const SELLER = "ce-sales@hardcode.local";
const TRAINER = "ce-trainer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const staffId = (email: string) => sql(`select id from ops.staff where email = '${email}'`);
// 2099-02-09 is a Monday: the camp (Tue to Thu) and every other item sit in one Monday-Sunday week.
const AGENDA = "/calendar?view=agenda&date=2099-02-09";
const MONTH = "/calendar?date=2099-02-09";

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${SELLER}', 'ZZ Seller', 'member', '{sales,outreach}'),
    ('${TRAINER}', 'ZZ Trainer', 'member', '{workshop}')`);
  for (const email of [FOUNDER, SELLER, TRAINER]) createPasswordUser(email, PASSWORD);
  for (const email of [FOUNDER, SELLER, TRAINER]) await (await signedIn(browser, email)).context().close();

  const seller = staffId(SELLER);
  const trainer = staffId(TRAINER);
  sql(`insert into ops.institution (name, kind, city, district, owner_id) values ('ZZ Cal School', 'school', 'Pune', 'Pune', '${seller}')`);
  sql(`insert into ops.institution (name, kind, city, district) values ('ZZ Other School', 'school', 'Nashik', 'Nashik')`);
  // Triggers off so the events can be scheduled without the certification set-up that other specs cover.
  sql(`set session_replication_role = replica;
    insert into ops.event (institution_id, kind, title, status, starts_at, ends_at, venue, expected_headcount)
      select id, 'school_workshop', 'ZZ Three Day Camp', 'scheduled', timestamptz '2099-02-10 09:00+05:30', timestamptz '2099-02-12 16:00+05:30', 'Main hall', 40
      from ops.institution where name = 'ZZ Cal School';
    insert into ops.event (institution_id, kind, title, status, starts_at, ends_at, venue, expected_headcount, lead_trainer_id)
      select id, 'school_workshop', 'ZZ Trainer Day', 'scheduled', timestamptz '2099-02-13 10:00+05:30', timestamptz '2099-02-13 14:00+05:30', 'Lab', 25, '${trainer}'
      from ops.institution where name = 'ZZ Other School'`);
  sql(`insert into ops.task (department, title, status, priority, due_date, due_time, assignee_id)
       values ('sales', 'ZZ Call the principal', 'todo', 2, '2099-02-11', '17:00', '${seller}')`);
  sql(`insert into ops.activity (institution_id, staff_id, kind, outcome, happened_at)
       select id, '${seller}', 'visit', 'interested', timestamptz '2099-02-10 10:00+05:30' from ops.institution where name = 'ZZ Cal School'`);
  sql(`set session_replication_role = replica;
       insert into ops.deal (institution_id, kind, title, stage, owner_id, expected_close)
       select id, 'workshop', 'ZZ Cal Deal', 'proposal', '${seller}', '2099-02-13' from ops.institution where name = 'ZZ Cal School'`);
});

test("my calendar lists workshops, tasks, outreach and deals together", async ({ browser }) => {
  const seller = await signedIn(browser, SELLER);
  await seller.goto(AGENDA);
  // The institution I own runs a three day workshop: one entry per day, numbered.
  await expect(seller.getByRole("heading", { name: "Workshops" }).first()).toBeVisible();
  await expect(seller.getByRole("link", { name: /ZZ Three Day Camp.*day 1 of 3.*Your institution/i })).toBeVisible();
  await expect(seller.getByText("Day 2 of 3")).toBeVisible();
  await expect(seller.getByText("Day 3 of 3")).toBeVisible();
  await expect(seller.getByText("From 9:00 am")).toBeVisible();
  await expect(seller.getByText("Until 4:00 pm")).toBeVisible();
  // Dated work assigned to me.
  await expect(seller.getByRole("link", { name: /Due 5:00 pm.*ZZ Call the principal/ })).toBeVisible();
  await expect(seller.getByRole("link", { name: /Visit · ZZ Cal School/ })).toBeVisible();
  await expect(seller.getByRole("link", { name: /Expected close.*ZZ Cal Deal/ })).toBeVisible();
  // The trainer-led workshop is not mine.
  await expect(seller.getByText("ZZ Trainer Day")).toHaveCount(0);
  await seller.context().close();
});

test("the month shows the workshop as one bar across its days", async ({ browser }) => {
  const seller = await signedIn(browser, SELLER);
  await seller.goto(MONTH);
  await expect(seller.getByRole("link", { name: /ZZ Three Day Camp/ })).toHaveCount(1);
  await expect(seller.getByRole("link", { name: /ZZ Call the principal, Due 5:00 pm/ })).toHaveCount(1);
  await expect(seller.getByRole("link", { name: /ZZ Call the principal, Due tomorrow/ })).toHaveCount(1);
  await expect(seller.getByRole("link", { name: /ZZ Call the principal, Due in 2 days/ })).toHaveCount(1);
  await seller.screenshot({ path: "test-results/calendar-month.png", fullPage: true });
  await seller.goto(`${MONTH}&view=week`);
  await expect(seller.getByRole("link", { name: /ZZ Three Day Camp/ })).toBeVisible();
  await seller.screenshot({ path: "test-results/calendar-week.png", fullPage: true });
  await seller.context().close();
});

test("the Show filter narrows to one kind of thing", async ({ browser }) => {
  const seller = await signedIn(browser, SELLER);
  await seller.goto(`${AGENDA}&show=tasks`);
  await expect(seller.getByRole("link", { name: /Due 5:00 pm.*ZZ Call the principal/ })).toBeVisible();
  await expect(seller.getByText("ZZ Three Day Camp")).toHaveCount(0);
  await seller.goto(`${AGENDA}&show=workshops`);
  await expect(seller.getByRole("link", { name: /ZZ Three Day Camp/ }).first()).toBeVisible();
  await expect(seller.getByText("ZZ Call the principal")).toHaveCount(0);
  await seller.context().close();
});

test("a workshop trainer sees only their own work, not a salesperson's", async ({ browser }) => {
  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto(AGENDA);
  await expect(trainer.getByRole("link", { name: /ZZ Trainer Day.*Leading/ })).toBeVisible();
  await expect(trainer.getByText("ZZ Call the principal")).toHaveCount(0);
  await expect(trainer.getByText("ZZ Cal Deal")).toHaveCount(0);
  await trainer.context().close();
});

test("the founder opens a person's calendar from the picker", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto(`${AGENDA}&scope=person`);
  await founder.getByRole("combobox", { name: "Whose calendar" }).click();
  await founder.getByRole("option", { name: "ZZ Seller" }).click();
  await expect(founder).toHaveURL(new RegExp(`who=${staffId(SELLER)}`));
  await expect(founder.getByText("ZZ Seller's calendar")).toBeVisible();
  await expect(founder.getByRole("link", { name: /Due 5:00 pm.*ZZ Call the principal/ })).toBeVisible();
  await expect(founder.getByRole("link", { name: /ZZ Three Day Camp.*Your institution/i }).first()).toBeVisible();

  await founder.goto(`${AGENDA}&scope=person&who=${staffId(TRAINER)}`);
  await expect(founder.getByRole("link", { name: /ZZ Trainer Day.*Leading/ })).toBeVisible();
  await expect(founder.getByText("ZZ Call the principal")).toHaveCount(0);

  // Everyone shows both people's work.
  await founder.goto(`${AGENDA}&scope=all`);
  await expect(founder.getByRole("link", { name: /ZZ Trainer Day/ })).toBeVisible();
  await expect(founder.getByRole("link", { name: /Due 5:00 pm.*ZZ Call the principal/ })).toBeVisible();
  await founder.context().close();
});
