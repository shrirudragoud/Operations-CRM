import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, pickDate, resetDatabase, signInWithPassword, sql } from "./helpers";

// Employee portal leave (0032) on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "pl-founder@hardcode.local";
const HRPERSON = "pl-hr@hardcode.local";
const MEMBER = "pl-member@hardcode.local";
const VIEWER = "pl-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

/** A Wednesday about three weeks ahead, so it is a working day and nowhere near the back-dating limit. */
function futureWednesday(): string {
  const d = new Date(Date.now() + 21 * 86_400_000);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${HRPERSON}', 'ZZ Hira', 'member', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, VIEWER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
});

test("a member applies, HR approves, and the balance and sheet follow", async ({ browser }) => {
  const day = futureWednesday();
  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/leave");
  await expect(member.getByRole("tab", { name: "Leave" })).toBeVisible();
  await expect(member.getByText("Casual leave").first()).toBeVisible();

  await member.getByRole("button", { name: "Apply for leave" }).click();
  await member.getByRole("combobox", { name: "Type of leave" }).click();
  await member.getByRole("option", { name: "Casual leave" }).click();
  await pickDate(member, "First day", day);
  await pickDate(member, "Last day", day);
  await member.getByLabel("Reason").fill("ZZ family function");
  await expect(member.getByRole("status").filter({ hasText: "1 day of leave" })).toBeVisible();
  await member.getByRole("button", { name: "Send request" }).click();
  await expect(member.getByRole("row").filter({ hasText: "ZZ family function" }).getByText("Waiting for a decision")).toBeVisible();

  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/leave");
  await expect(hr.getByRole("heading", { name: "Leave", level: 1 })).toBeVisible();
  await hr.getByRole("button", { name: "Approve leave for ZZ Member" }).click();
  await expect.poll(() => sql(`select state from ops.leave_request where reason = 'ZZ family function'`)).toBe("approved");

  await member.reload();
  await expect(member.getByRole("row").filter({ hasText: "ZZ family function" }).getByText("Approved")).toBeVisible();
});

test("turning a request down needs a reason, and the person sees it", async ({ browser }) => {
  const day = futureWednesday();
  const dayLater = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/leave");
  await member.getByRole("button", { name: "Apply for leave" }).click();
  await member.getByRole("combobox", { name: "Type of leave" }).click();
  await member.getByRole("option", { name: "Sick leave" }).click();
  await pickDate(member, "First day", dayLater);
  await pickDate(member, "Last day", dayLater);
  await member.getByLabel("Reason").fill("ZZ appointment");
  await member.getByRole("button", { name: "Send request" }).click();
  await expect(member.getByRole("row").filter({ hasText: "ZZ appointment" })).toBeVisible();

  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/leave");
  await hr.getByRole("button", { name: "Turn down leave for ZZ Member" }).click();
  await hr.getByRole("button", { name: "Turn down", exact: true }).last().click();
  await expect(hr.getByRole("alert").filter({ hasNotText: "Hard-Code Ops" })).toBeVisible();
  await hr.getByLabel("Reason").fill("Release day, please pick another");
  await hr.getByRole("button", { name: "Turn down", exact: true }).last().click();
  await expect.poll(() => sql(`select state from ops.leave_request where reason = 'ZZ appointment'`)).toBe("rejected");

  await member.reload();
  await expect(member.getByText("Release day, please pick another")).toBeVisible();
});

test("a member withdraws leave that has not started", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/leave");
  await member.getByRole("button", { name: /^Withdraw Casual leave/ }).click();
  await expect.poll(() => sql(`select state from ops.leave_request where reason = 'ZZ family function'`)).toBe("cancelled");
});

test("HR changes the leave policy and adds a holiday", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/leave");
  await hr.getByRole("button", { name: "Add a type of leave" }).click();
  await hr.locator("#lt-name").fill("ZZ Study leave");
  await hr.getByLabel("Days a year").fill("5");
  await hr.getByRole("switch", { name: "Carry forward" }).click();
  await hr.getByLabel("Most days that carry over").fill("2");
  await hr.getByRole("button", { name: "Save" }).click();
  await expect(hr.getByRole("row").filter({ hasText: "ZZ Study leave" }).getByText(/5 days a year, carries over up to 2 days/)).toBeVisible();
  await expect(hr.getByRole("dialog")).toBeHidden();

  await pickDate(hr, "Day", futureWednesday());
  await hr.locator("#hol-name").fill("ZZ Founders day");
  await hr.getByRole("button", { name: "Add holiday" }).click();
  await expect(hr.getByRole("list", { name: "Upcoming holidays" }).getByText("ZZ Founders day")).toBeVisible();
});

test("viewers have no Leave tab and are told so", async ({ browser }) => {
  const viewer = await signedIn(browser, VIEWER);
  await viewer.goto("/me/leave");
  await expect(viewer.getByText("Your role does not take leave.")).toBeVisible();
  const member = await signedIn(browser, MEMBER);
  await member.goto("/hr/leave");
  await expect(member.getByText("You don't have access to leave approvals")).toBeVisible();
});
