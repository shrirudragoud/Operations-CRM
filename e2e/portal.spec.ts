import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Employee portal foundations (0029) on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "pt-founder@hardcode.local";
const HRPERSON = "pt-hr@hardcode.local";
const MEMBER = "pt-member@hardcode.local";
const VIEWER = "pt-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${HRPERSON}', 'ZZ Hira', 'member', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, VIEWER]) await (await signedIn(browser, email)).context().close();
});

test("the founder makes a member HR, and only HR sees the People & HR page", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/team");
  await founder.getByRole("button", { name: "Actions for ZZ Hira" }).click();
  await founder.getByRole("menuitem", { name: "Make HR" }).click();
  await expect.poll(() => sql(`select is_hr from ops.staff where email = '${HRPERSON}'`)).toBe("t");
  await expect(founder.getByRole("row").filter({ hasText: "ZZ Hira" }).getByText("HR", { exact: true })).toBeVisible();

  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr");
  await expect(hr.getByRole("heading", { name: "People & HR" })).toBeVisible();
  await expect(hr.getByText("No one has opened a private record yet.")).toBeVisible();

  const member = await signedIn(browser, MEMBER);
  await member.goto("/hr");
  await expect(member.getByText("You don't have access to People & HR")).toBeVisible();
});

test("viewers cannot be made HR and the menu does not offer it", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/team");
  await founder.getByRole("button", { name: "Actions for ZZ Viewer" }).click();
  await expect(founder.getByRole("menuitem", { name: "Make HR" })).toBeHidden();
  await expect(founder.getByRole("menuitem", { name: "Edit role and departments" })).toBeVisible();
});

test("everyone opens their own space from the sidebar and sees their details", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER);
  await member.getByRole("link", { name: "My space" }).click();
  await expect(member).toHaveURL(/\/me$/);
  await expect(member.getByRole("heading", { name: "My space", level: 1 })).toBeVisible();
  await expect(member.getByRole("heading", { name: "ZZ Member" })).toBeVisible();
  await expect(member.locator("#main").getByText("Workshop", { exact: true })).toBeVisible();
  await expect(member.getByText("Open tasks")).toBeVisible();
  await expect(member.getByText("Attendance is not switched on for you yet.")).toBeVisible();

  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/me");
  await expect(hr.locator("#main").getByText("HR", { exact: true })).toBeVisible();
  await expect(hr.getByRole("link", { name: "People & HR" })).toBeVisible();
});
