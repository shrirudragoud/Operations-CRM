import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// Calendar and meetings on the LOCAL stack only (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "mt-founder@hardcode.local";
const SELLER = "mt-sales@hardcode.local";
const TRAINER = "mt-trainer@hardcode.local";
const OUTSIDER = "mt-outsider@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const DAY = "2099-01-15";
const AGENDA = `/calendar?view=agenda&date=${DAY}`;
const TEAM_MEETING = "ZZ Sales and Workshop sync";
const REQUESTED = "ZZ One to one chat";
const FIXED = "ZZ Weekly sales stand-up";

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${SELLER}', 'ZZ Seller', 'member', '{sales}'),
    ('${TRAINER}', 'ZZ Trainer', 'member', '{workshop}'),
    ('${OUTSIDER}', 'ZZ Outsider', 'member', '{community}')`);
  for (const email of [FOUNDER, SELLER, TRAINER, OUTSIDER]) createPasswordUser(email, PASSWORD);
  for (const email of [SELLER, TRAINER, OUTSIDER]) await (await signedIn(browser, email)).context().close();
});

test("a Sales member schedules a meeting and the invitee answers Going", async ({ browser }) => {
  const seller = await signedIn(browser, SELLER);
  await seller.goto(AGENDA);
  await seller.getByRole("button", { name: "New meeting" }).click();
  const dialog = seller.getByRole("dialog", { name: /meeting/i });
  await dialog.getByLabel("Title").fill(TEAM_MEETING);
  await pickDate(seller, "Date", DAY);
  await dialog.getByLabel("From (India time)").click();
  await seller.getByRole("option", { name: "11:00 am" }).click();
  await dialog.getByLabel("Place or link (optional)").fill("Board room");
  await dialog.getByRole("combobox", { name: /Invite people/ }).click();
  await seller.getByRole("option", { name: "ZZ Trainer" }).click();
  await seller.keyboard.press("Escape");
  await expect(dialog.getByRole("list", { name: "Chosen people" })).toContainText("ZZ Trainer");
  await dialog.getByRole("button", { name: "Schedule meeting" }).click();
  await expect(seller).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
  await expect(seller.getByRole("heading", { name: TEAM_MEETING })).toBeVisible();

  // It shows on the organizer's calendar.
  await seller.goto(AGENDA);
  await expect(seller.getByRole("link", { name: new RegExp(TEAM_MEETING) })).toBeVisible();

  // The invitee sees it, is told it needs an answer, and says Going.
  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto(AGENDA);
  await expect(trainer.getByRole("link", { name: new RegExp(`${TEAM_MEETING}.*needs your answer`, "i") })).toBeVisible();
  await trainer.getByRole("link", { name: new RegExp(TEAM_MEETING) }).first().click();
  await trainer.getByRole("button", { name: "Going", exact: true }).click();
  await expect(trainer.getByText("Answered: Going", { exact: true })).toBeVisible();
  expect(sql(`select rsvp from ops.meeting_attendee a join ops.staff s on s.id = a.staff_id where s.email = '${TRAINER}'`)).toBe("accepted");

  // A person who was not invited cannot see an invitees-only meeting.
  const outsider = await signedIn(browser, OUTSIDER);
  await outsider.goto(AGENDA);
  await expect(outsider.getByRole("link", { name: new RegExp(TEAM_MEETING) })).toHaveCount(0);
  await seller.context().close();
  await trainer.context().close();
  await outsider.context().close();
});

test("a meeting request waits for the person asked, who can accept it", async ({ browser }) => {
  const seller = await signedIn(browser, SELLER);
  await seller.goto(AGENDA);
  await seller.getByRole("button", { name: "New meeting" }).click();
  const dialog = seller.getByRole("dialog", { name: /meeting/i });
  await dialog.getByRole("button", { name: "Ask for a time" }).click();
  await dialog.getByLabel("Title").fill(REQUESTED);
  await pickDate(seller, "Date", DAY);
  await dialog.getByLabel("From (India time)").click();
  await seller.getByRole("option", { name: "3:00 pm" }).click();
  await dialog.getByLabel("Who are you asking?").click();
  await seller.getByRole("option", { name: "ZZ Trainer" }).click();
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(seller).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
  expect(sql(`select status from ops.meeting where title = '${REQUESTED}'`)).toBe("requested");

  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto("/calendar");
  await expect(trainer.getByRole("list", { name: "Waiting for your answer" }).getByText(REQUESTED)).toBeVisible();
  await trainer.getByRole("link", { name: REQUESTED }).click();
  await trainer.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(trainer.getByText("Accepted. It is on the calendar.")).toBeVisible();
  expect(sql(`select status from ops.meeting where title = '${REQUESTED}'`)).toBe("scheduled");
  await seller.context().close();
  await trainer.context().close();
});

test("declining a request needs a reason and tells the requester", async ({ browser }) => {
  const when = new Date(Date.now() + 5.5 * 3600_000 + 5 * 86_400_000).toISOString();
  sql(`insert into ops.meeting (title, kind, visibility, status, starts_at, ends_at, organizer_id, host_id, awaiting_id)
       select 'ZZ Declined ask', 'one_to_one', 'invitees', 'requested', '${when}'::timestamptz, '${when}'::timestamptz + interval '30 minutes', s.id, t.id, t.id
       from ops.staff s, ops.staff t where s.email = '${SELLER}' and t.email = '${TRAINER}'`);
  const id = sql("select id from ops.meeting where title = 'ZZ Declined ask'");
  const trainer = await signedIn(browser, TRAINER);
  await trainer.goto(`/calendar/${id}`);
  await trainer.getByRole("button", { name: "Decline", exact: true }).click();
  const declineButton = trainer.getByRole("button", { name: "Decline request" });
  await expect(declineButton).toBeDisabled();
  await trainer.getByLabel("Why you are declining").fill("ZZ I am at a workshop that day");
  await declineButton.click();
  await expect(trainer.getByText("Request declined")).toBeVisible();
  expect(sql("select status from ops.meeting where title = 'ZZ Declined ask'")).toBe("declined");
  expect(sql(`select count(*) from ops.notification n join ops.staff s on s.id = n.recipient_id where s.email = '${SELLER}' and n.kind = 'meeting_response'`)).not.toBe("0");
  await trainer.context().close();
});

test("a fixed weekly meeting fills the calendar ahead", async ({ browser }) => {
  const first = new Date(Date.now() + 5.5 * 3600_000 + 2 * 86_400_000).toISOString().slice(0, 10);
  const seller = await signedIn(browser, SELLER);
  await seller.goto("/calendar/series");
  await seller.getByRole("button", { name: "New meeting" }).click();
  const dialog = seller.getByRole("dialog", { name: /meeting/i });
  await dialog.getByLabel("Title").fill(FIXED);
  await dialog.getByLabel("Repeats").click();
  await seller.getByRole("option", { name: "Every week" }).click();
  await pickDate(seller, "First date", first);
  await dialog.getByRole("combobox", { name: /Invite people/ }).click();
  await seller.getByRole("option", { name: "ZZ Trainer" }).click();
  await seller.keyboard.press("Escape");
  await expect(dialog.getByRole("list", { name: "Chosen people" })).toContainText("ZZ Trainer");
  await dialog.getByRole("button", { name: "Create fixed meeting" }).click();
  await expect(seller).toHaveURL(/\/calendar\/series$/);
  await expect(seller.getByRole("list", { name: "Fixed meetings" }).getByText(FIXED)).toBeVisible();
  // 35 days ahead from a start 2 days away: at least four weekly occurrences exist.
  expect(Number(sql(`select count(*) from ops.meeting m join ops.meeting_series s on s.id = m.series_id where s.title = '${FIXED}'`))).toBeGreaterThanOrEqual(4);

  // The trainer is invited once per series and answers every upcoming occurrence in one click.
  const occurrenceIds = sql(`select string_agg(m.id::text, ',' order by m.starts_at) from ops.meeting m join ops.meeting_series s on s.id = m.series_id where s.title = '${FIXED}'`).split(",");
  expect(sql(`select count(*) from ops.notification n join ops.staff t on t.id = n.recipient_id where t.email = '${TRAINER}' and n.kind = 'meeting_invite' and n.dedupe_key like 'series:%'`)).toBe("1");
  const trainerPage = await signedIn(browser, TRAINER);
  await trainerPage.goto(`/calendar/${occurrenceIds[0]}`);
  await trainerPage.getByRole("button", { name: "Going to all upcoming" }).click();
  await expect(trainerPage.getByText("Going to every upcoming one")).toBeVisible();
  await trainerPage.goto(`/calendar/${occurrenceIds[2]}`);
  await expect(trainerPage.getByText("You answered: Going")).toBeVisible();
  expect(sql(`select count(*) from ops.meeting_attendee a join ops.staff t on t.id = a.staff_id join ops.meeting m on m.id = a.meeting_id join ops.meeting_series s on s.id = m.series_id where s.title = '${FIXED}' and t.email = '${TRAINER}' and a.rsvp = 'invited'`)).toBe("0");
  await trainerPage.context().close();

  // Pausing stops it; deleting leaves the already-generated meetings alone.
  await seller.getByRole("button", { name: /Pause/ }).click();
  await expect(seller.getByText("Paused", { exact: true })).toBeVisible();
  await seller.context().close();
});

test("cancelling a meeting needs a reason and the invitees are told", async ({ browser }) => {
  const seller = await signedIn(browser, SELLER);
  const id = sql(`select id from ops.meeting where title = '${TEAM_MEETING}'`);
  await seller.goto(`/calendar/${id}`);
  await seller.getByRole("button", { name: "Cancel meeting" }).click();
  const submit = seller.getByRole("dialog").getByRole("button", { name: "Cancel meeting" });
  await expect(submit).toBeDisabled();
  await seller.getByLabel("Why it is cancelled").fill("ZZ Clashes with a school visit");
  await submit.click();
  await expect(seller.getByText("Meeting cancelled. People are told.")).toBeVisible();
  expect(sql(`select status from ops.meeting where id = '${id}'`)).toBe("cancelled");
  expect(sql(`select count(*) from ops.notification n join ops.staff s on s.id = n.recipient_id where s.email = '${TRAINER}' and n.kind = 'meeting_cancel'`)).not.toBe("0");
  await seller.context().close();
});

test("the founder sees everyone's meetings under Everyone", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto(`${AGENDA}&scope=all`);
  await expect(founder.getByRole("link", { name: new RegExp(REQUESTED) })).toBeVisible();
  await founder.context().close();
});
