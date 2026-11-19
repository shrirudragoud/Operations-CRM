import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Employee portal P5 (0034): asking HR, the thread with internal notes, and joining/leaving checklists. LOCAL stack only.
const PASSWORD = "correct-horse-battery";
const FOUNDER = "pr-founder@hardcode.local";
const HRPERSON = "pr-hr@hardcode.local";
const MEMBER = "pr-member@hardcode.local";
const OTHER = "pr-other@hardcode.local";
const VIEWER = "pr-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const staffId = (email: string) => sql(`select id from ops.staff where email = '${email}'`);

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${HRPERSON}', 'ZZ Hira', 'member', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}'),
    ('${OTHER}', 'ZZ Other', 'member', '{sales}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, OTHER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, OTHER, VIEWER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
});

test("a member asks HR for a letter and sees it open", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me");
  await page.getByRole("tab", { name: "Ask HR" }).click();
  await expect(page).toHaveURL(/\/me\/requests$/);

  await page.getByRole("button", { name: "Send to HR" }).click();
  await expect(page.getByText("Say what you need.")).toBeVisible();

  await page.getByLabel("Subject").fill("Experience letter for a visa");
  await page.getByLabel("Details (optional)").fill("Needed by the 20th.");
  await page.getByRole("button", { name: "Send to HR" }).click();
  await expect(page.getByRole("heading", { name: "Experience letter for a visa" })).toBeVisible();
  await expect.poll(() => sql(`select state from ops.hr_request where staff_id = '${staffId(MEMBER)}'`)).toBe("open");
});

test("another employee cannot see the request", async ({ browser }) => {
  const page = await signedIn(browser, OTHER);
  await page.goto("/me/requests");
  await expect(page.getByText("Experience letter for a visa")).toHaveCount(0);
});

test("HR leaves an internal note the member never sees, then replies and finishes it", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/requests");
  const card = hr.getByRole("region", { name: /Experience letter for a visa/ });
  await card.getByLabel("Write a message").fill("Check the joining date first");
  await card.getByLabel("Internal note, the person won't see it").check();
  await card.getByRole("button", { name: "Send message on Experience letter for a visa" }).click();
  await expect.poll(() => sql(`select count(*) from ops.hr_request_message where internal`)).toBe("1");

  await card.getByLabel("Write a message").fill("It is ready, collect it from the office.");
  await card.getByRole("button", { name: "Send message on Experience letter for a visa" }).click();
  await card.getByRole("button", { name: "Mark Experience letter for a visa done" }).click();
  await expect.poll(() => sql(`select state from ops.hr_request where staff_id = '${staffId(MEMBER)}'`)).toBe("done");

  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/requests");
  await expect(member.getByText("It is ready, collect it from the office.")).toBeVisible();
  await expect(member.getByText("Check the joining date first")).toHaveCount(0);
});

test("a rejection needs a note", async ({ browser }) => {
  sql(`insert into ops.hr_request (staff_id, kind, subject, details) values ('${staffId(MEMBER)}', 'other', 'Change my desk', '')`);
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/requests");
  const card = hr.getByRole("region", { name: /Change my desk/ });
  await expect(card.getByRole("button", { name: "Reject Change my desk" })).toBeDisabled();
  await card.getByLabel("Note for the person (needed to reject)").fill("Desks are fixed this quarter.");
  await card.getByRole("button", { name: "Reject Change my desk" }).click();
  await expect.poll(() => sql(`select state from ops.hr_request where subject = 'Change my desk'`)).toBe("rejected");
});

test("HR starts a joining checklist, the person ticks only their own steps", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/onboarding");
  await hr.getByRole("combobox", { name: "Person" }).click();
  await hr.getByRole("option", { name: "ZZ Other" }).click();
  await hr.getByRole("button", { name: "Start checklist" }).click();
  await expect(hr.getByText(/Checklist started with \d+ steps/)).toBeVisible();
  await expect.poll(() => sql(`select count(*) > 0 from ops.onboarding_task where staff_id = '${staffId(OTHER)}'`)).toBe("t");

  const other = await signedIn(browser, OTHER);
  await other.goto("/me/requests");
  await expect(other.getByText("Your joining checklist")).toBeVisible();
  const boxes = other.getByRole("list", { name: "Joining" }).getByRole("checkbox");
  expect(await boxes.count()).toBeGreaterThan(0);
  await expect(other.getByRole("checkbox", { name: "Set up email and tool accounts" })).toBeDisabled();
  await expect(other.getByRole("checkbox", { name: "Upload your ID and address proof" })).toBeEnabled();
});

test("a viewer has no Ask HR tab", async ({ browser }) => {
  const page = await signedIn(browser, VIEWER);
  await page.goto("/me");
  await expect(page.getByRole("tab", { name: "Ask HR" })).toHaveCount(0);
});
