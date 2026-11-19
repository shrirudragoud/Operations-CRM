import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Employee portal P2 and P5 (0031, 0035): the profile, the HR record and the directory. LOCAL stack only.
const PASSWORD = "correct-horse-battery";
const FOUNDER = "pp-founder@hardcode.local";
const HRPERSON = "pp-hr@hardcode.local";
const MEMBER = "pp-member@hardcode.local";
const COLLEAGUE = "pp-colleague@hardcode.local";
const VIEWER = "pp-viewer@hardcode.local";

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
    ('${COLLEAGUE}', 'ZZ Colleague', 'member', '{sales}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, COLLEAGUE, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, COLLEAGUE, VIEWER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
});

test("a member fills in their profile and sees the fields HR owns as read-only", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me");
  await page.getByRole("tab", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);

  await page.getByLabel("Legal name").fill("Zed Member Kumar");
  await page.getByLabel("Date of birth").fill("1994-05-17");
  await page.getByLabel("Personal phone").fill("+91 98765 43210");
  await page.getByLabel("Emergency contact", { exact: true }).fill("ZZ Parent");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Give both the name and the phone of your emergency contact")).toBeVisible();

  await page.getByLabel("Emergency phone").fill("9876501234");
  await page.getByLabel("Relationship").fill("Parent");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await expect.poll(() => sql(`select legal_name from ops.staff_profile where staff_id = '${staffId(MEMBER)}'`)).toBe("Zed Member Kumar");

  await expect(page.getByText("Set by HR")).toBeVisible();
  await expect(page.getByLabel("Designation")).toHaveCount(0);
  await expect(page.getByLabel("Employee code")).toHaveCount(0);
});

test("the database refuses a member who edits an HR field directly", async () => {
  expect(() => sql(`
    set role authenticated; select set_config('request.jwt.claims', '{"sub":"${staffId(MEMBER)}","role":"authenticated"}', false);
    update ops.staff_profile set designation = 'CEO' where staff_id = '${staffId(MEMBER)}';`)).toThrow();
  expect(sql(`select coalesce(designation, 'none') from ops.staff_profile where staff_id = '${staffId(MEMBER)}'`)).toBe("none");
});

test("HR sets the HR fields and the member then reads them", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr");
  await hr.getByRole("link", { name: "People records" }).click();
  await expect(hr).toHaveURL(/\/hr\/people$/);
  await hr.getByRole("link", { name: "ZZ Member" }).click();
  await expect(hr.getByRole("heading", { name: "ZZ Member" })).toBeVisible();
  await expect(hr.getByText("Zed Member Kumar")).toBeVisible();

  await hr.getByLabel("Employee code").fill("HC-101");
  await hr.getByLabel("Designation").fill("Workshop Engineer");
  await hr.getByLabel("Joined on").fill("2024-02-12");
  await hr.getByRole("button", { name: "Save record" }).click();
  await expect(hr.getByText("Record saved")).toBeVisible();
  await expect.poll(() => sql(`select employee_code from ops.staff_profile where staff_id = '${staffId(MEMBER)}'`)).toBe("HC-101");
  expect(sql(`select count(*) from ops.hr_access_log where what = 'opened profile' and target_id = '${staffId(MEMBER)}'`)).not.toBe("0");

  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/profile");
  await expect(member.getByText("HC-101")).toBeVisible();
  await expect(member.getByText("Workshop Engineer")).toBeVisible();
});

test("a duplicate employee code is refused with a readable message", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto(`/hr/people/${staffId(COLLEAGUE)}`);
  await hr.getByLabel("Employee code").fill("HC-101");
  await hr.getByRole("button", { name: "Save record" }).click();
  await expect(hr.getByText("That already exists. Check for a duplicate.")).toBeVisible();
});

test("a plain member cannot open the HR record pages", async ({ browser }) => {
  const member = await signedIn(browser, COLLEAGUE);
  await member.goto("/hr/people");
  await expect(member.getByText("You don't have access to People & HR")).toBeVisible();
  await member.goto(`/hr/people/${staffId(MEMBER)}`);
  await expect(member.getByText("You don't have access to People & HR")).toBeVisible();
});

test("the directory shows work contacts only and a birthday only after consent", async ({ browser }) => {
  sql(`update ops.staff_profile set birth_date = make_date(1994, extract(month from current_date)::int, 15), birthday_visible = false
        where staff_id = '${staffId(MEMBER)}'`);
  const colleague = await signedIn(browser, COLLEAGUE);
  await colleague.goto("/me/directory");
  await expect(colleague.getByText("Team directory", { exact: true })).toBeVisible();
  const row = colleague.getByRole("row").filter({ hasText: "ZZ Member" });
  await expect(row.getByText("Workshop Engineer")).toBeVisible();
  await expect(colleague.getByText("+91 98765 43210")).toHaveCount(0);
  await expect(colleague.getByText("Zed Member Kumar")).toHaveCount(0);
  await expect(colleague.getByText("Nothing to celebrate this month.")).toBeVisible();

  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/profile");
  await member.getByRole("checkbox", { name: "Show my birthday to colleagues" }).click();
  await member.getByRole("button", { name: "Save profile" }).click();
  await expect(member.getByText("Profile saved")).toBeVisible();

  await colleague.reload();
  await expect(colleague.getByText("· ZZ Member · Birthday")).toBeVisible();
  await expect(colleague.getByText("1994")).toHaveCount(0);
});

test("the directory search narrows the list", async ({ browser }) => {
  const colleague = await signedIn(browser, COLLEAGUE);
  await colleague.goto("/me/directory");
  await colleague.getByLabel("Search the directory").fill("hira");
  await colleague.getByRole("button", { name: "Search" }).click();
  await expect(colleague.getByRole("row").filter({ hasText: "ZZ Hira" })).toBeVisible();
  await expect(colleague.getByRole("row").filter({ hasText: "ZZ Member" })).toHaveCount(0);
});

test("a viewer has no Profile or Directory tab", async ({ browser }) => {
  const viewer = await signedIn(browser, VIEWER);
  await viewer.goto("/me");
  await expect(viewer.getByRole("tab", { name: "Profile" })).toHaveCount(0);
  await expect(viewer.getByRole("tab", { name: "Directory" })).toHaveCount(0);
  await viewer.goto("/me/directory");
  await expect(viewer.getByText("The directory is for team members.")).toBeVisible();
});
