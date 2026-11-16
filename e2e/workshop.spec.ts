import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Workshop workspace on the LOCAL stack only (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "ws-founder@hardcode.local";
const TRAINER = "ws-trainer@hardcode.local";
const SALES = "ws-sales@hardcode.local";
const PARTNER = "ws-partner@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const one = (q: string) => sql(q);
const EVENT = "ZZ Camp Event";

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${TRAINER}', 'ZZ Trainer', 'member', '{workshop}'),
    ('${SALES}', 'ZZ Seller', 'member', '{sales}'),
    ('${PARTNER}', 'ZZ Partner', 'partner', '{}')`);
  for (const email of [FOUNDER, TRAINER, SALES, PARTNER]) createPasswordUser(email, PASSWORD);
  for (const email of [TRAINER, SALES, PARTNER]) await (await signedIn(browser, email)).context().close();
  sql(`insert into ops.training_program (id, name, audience) values ('11111111-1111-1111-1111-111111111111', 'Trainer L1', 'internal_trainer') on conflict (id) do nothing;
       insert into ops.enrollment (program_id, staff_id, status, certified_at)
         select '11111111-1111-1111-1111-111111111111', id, 'certified', now() from ops.staff where email = '${TRAINER}'`);
  sql(`insert into ops.institution (name, kind, city, district) values
    ('ZZ Camp College', 'engineering_college', 'Pune', 'Pune'),
    ('ZZ Busy School', 'school', 'Nashik', 'Nashik')`);
});

test("a Workshop member creates an event, schedules it with a trainer and sees it on the calendar", async ({ browser }) => {
  const page = await signedIn(browser, TRAINER);
  await page.goto("/workshop");
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByRole("combobox", { name: "Institution" }).click();
  await page.getByPlaceholder("Type a name or city…").fill("ZZ Camp");
  await page.getByRole("option", { name: "ZZ Camp College" }).click();
  await page.getByLabel("Title (optional)").fill(EVENT);
  await page.getByRole("dialog").getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/workshop\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: EVENT })).toBeVisible();
  expect(one(`select status from ops.event where title = '${EVENT}'`)).toBe("draft");

  await expect(page.getByText(/To schedule, still needed: lead trainer, start, end, venue, expected headcount/)).toBeVisible();
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText(/To schedule this event, set:/)).toBeVisible();
  expect(one(`select status from ops.event where title = '${EVENT}'`)).toBe("draft");

  await page.getByLabel("Starts (India time)").fill("2030-03-12T09:30");
  await page.getByRole("button", { name: "1-day workshop" }).click();
  await expect(page.getByLabel("Ends (India time)")).toHaveValue("2030-03-12T15:30");
  await page.getByLabel("Venue").fill("ZZ Seminar Hall");
  await page.getByLabel("Expected students").fill("40");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Event saved")).toBeVisible();
  expect(one(`select venue || ':' || expected_headcount || ':' || starts_at at time zone 'Asia/Kolkata' from ops.event where title = '${EVENT}'`)).toBe("ZZ Seminar Hall:40:2030-03-12 09:30:00");

  await page.getByLabel("Lead trainer").click();
  await page.getByRole("option", { name: "ZZ Trainer" }).click();
  await page.getByRole("button", { name: "Save team" }).click();
  await expect(page.getByText("Team saved")).toBeVisible();
  expect(one(`select s.full_name from ops.event e join ops.staff s on s.id = e.lead_trainer_id where e.title = '${EVENT}'`)).toBe("ZZ Trainer");

  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText(/Event scheduled/)).toBeVisible();
  await expect.poll(() => one(`select status from ops.event where title = '${EVENT}'`)).toBe("scheduled");
  const code = one(`select c.code from ops.cohort c join ops.event e on e.id = c.event_id where e.title = '${EVENT}'`);
  expect(code).toMatch(/^HC-/);
  await expect(page.getByRole("button", { name: `Copy cohort code ${code}` })).toBeVisible();
  await expect(page.getByRole("checkbox").first()).toBeVisible();

  await page.goto("/workshop?month=2030-03");
  await expect(page.getByRole("heading", { name: /March 2030/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /ZZ Camp College.*Scheduled/ })).toBeVisible();
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByRole("link", { name: /ZZ Camp College/ })).toBeHidden();

  await page.goto("/workshop?tab=events");
  await expect(page.getByRole("link", { name: EVENT })).toBeVisible();
});

test("ticking the run sheet stamps the person, and completing needs every before and on-the-day item", async ({ browser }) => {
  const page = await signedIn(browser, TRAINER);
  const id = one(`select id from ops.event where title = '${EVENT}'`);
  await page.goto(`/workshop/${id}`);

  const first = page.getByRole("checkbox").first();
  await first.click();
  await expect(first).toBeChecked();
  await expect.poll(() => one(`select count(*) from ops.run_sheet_item r join ops.staff s on s.id = r.done_by where r.event_id = '${id}' and s.full_name = 'ZZ Trainer'`)).toBe("1");

  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByLabel("Students who attended").fill("36");
  await page.getByRole("dialog").getByRole("button", { name: "Complete event" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(/Finish all pre-event and event-day run sheet items first/);
  expect(one(`select status from ops.event where id = '${id}'`)).toBe("scheduled");

  sql(`update ops.run_sheet_item set done_at = now() where event_id = '${id}' and phase in ('pre','day') and done_at is null`);
  await page.getByRole("dialog").getByRole("button", { name: "Complete event" }).click();
  await expect(page.getByText("Event completed")).toBeVisible();
  await expect.poll(() => one(`select status || ':' || actual_headcount from ops.event where id = '${id}'`)).toBe("completed:36");
  expect(one(`select count(*) from ops.task t where t.entity_type = 'event' and t.entity_id = '${id}' and t.template in ('send_survey','close_returns','collect_photos','college_report')`)).toBe("4");
  expect(one("select stage from ops.institution where name = 'ZZ Camp College'")).toBe("workshop_delivered");
  await page.reload();
  await expect(page.getByRole("button", { name: "Complete" })).toBeHidden();
  await expect(page.getByLabel("Title")).toBeHidden();
});

test("cancelling needs a reason, and a busy trainer cannot be picked for an overlapping event", async ({ browser }) => {
  sql(`insert into ops.event (institution_id, kind, title, status, starts_at, ends_at, venue, expected_headcount, lead_trainer_id)
       select i.id, 'school_workshop', 'ZZ Busy Event', 'draft', timestamptz '2030-04-10 09:30+05:30', timestamptz '2030-04-10 15:30+05:30', 'Hall', 30, s.id
       from ops.institution i, ops.staff s where i.name = 'ZZ Busy School' and s.email = '${TRAINER}'`);
  sql("update ops.event set status = 'scheduled' where title = 'ZZ Busy Event'");
  sql(`insert into ops.event (institution_id, kind, title, starts_at, ends_at, venue, expected_headcount)
       select i.id, 'college_workshop', 'ZZ Clash Event', timestamptz '2030-04-10 10:00+05:30', timestamptz '2030-04-10 14:00+05:30', 'Hall 2', 20
       from ops.institution i where i.name = 'ZZ Camp College'`);
  const id = one("select id from ops.event where title = 'ZZ Clash Event'");

  const page = await signedIn(browser, TRAINER);
  await page.goto(`/workshop/${id}`);
  await page.getByLabel("Lead trainer").click();
  await expect(page.getByRole("option", { name: "ZZ Trainer (busy)" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Cancel event" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel event" }).click();
  await expect(page.getByText("Say why the event is cancelled.")).toBeVisible();
  expect(one(`select status from ops.event where id = '${id}'`)).toBe("draft");
  await page.getByLabel("Why is it cancelled?").fill("ZZ college postponed the camp");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel event" }).click();
  await expect.poll(() => one(`select status || ':' || cancel_reason from ops.event where id = '${id}'`)).toBe("cancelled:ZZ college postponed the camp");
  await page.reload();
  await expect(page.getByText("ZZ college postponed the camp")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to draft" })).toBeHidden();
});

test("the Institution 360 links to its events", async ({ browser }) => {
  const page = await signedIn(browser, TRAINER);
  await page.goto("/institutions");
  await page.getByRole("link", { name: "ZZ Camp College" }).click();
  await page.getByRole("tab", { name: "Events" }).click();
  await page.getByRole("link", { name: EVENT }).click();
  await expect(page).toHaveURL(/\/workshop\/[0-9a-f-]{36}$/);
});

test("only the Workshop department opens Workshop: Sales and a partner see no access page", async ({ browser }) => {
  const id = one(`select id from ops.event where title = '${EVENT}'`);
  const seller = await signedIn(browser, SALES);
  await seller.goto(`/workshop/${id}`);
  await expect(seller.getByText(/don.t have access|not available|permission/i).first()).toBeVisible();
  await expect(seller.getByRole("heading", { name: EVENT })).toBeHidden();
  await seller.goto("/workshop");
  await expect(seller.getByRole("button", { name: "New event" })).toBeHidden();

  const partner = await signedIn(browser, PARTNER);
  await partner.goto("/workshop");
  await expect(partner.getByText(/don.t have access|not available|permission/i).first()).toBeVisible();
  await partner.goto(`/workshop/${id}`);
  await expect(partner.getByRole("heading", { name: EVENT })).toBeHidden();
});
