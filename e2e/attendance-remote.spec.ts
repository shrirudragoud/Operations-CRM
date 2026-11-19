import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Remote check-in (0030) on the LOCAL stack only. No office network is configured in this file.
const PASSWORD = "correct-horse-battery";
const FOUNDER = "ar-founder@hardcode.local";
const REMOTE = "ar-remote@hardcode.local";
const OFFICE = "ar-office@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const staffId = (email: string) => sql(`select id from ops.staff where email = '${email}'`);
const chip = (page: Page, name: "You are checked in" | "You are not checked in") => page.getByRole("status", { name });

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${REMOTE}', 'ZZ Remote', 'member', '{sales}'),
    ('${OFFICE}', 'ZZ Office', 'member', '{sales}')`);
  for (const email of [FOUNDER, REMOTE, OFFICE]) createPasswordUser(email, PASSWORD);
  for (const email of [REMOTE, OFFICE]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.office_settings set ip_header = 'x-forwarded-for', ip_hops = 1, work_days = '{1,2,3,4,5,6,7}'`);
});

test("the founder tracks two people and switches one to remote", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/team");
  for (const name of ["ZZ Remote", "ZZ Office"]) {
    await founder.getByRole("button", { name: `Actions for ${name}` }).click();
    await founder.getByRole("menuitem", { name: /Track attendance/ }).click();
    await expect.poll(() => sql(`select works_from_office from ops.staff where full_name = '${name}'`)).toBe("t");
    await expect(founder.getByRole("menuitem")).toHaveCount(0);
  }
  await founder.getByRole("button", { name: "Actions for ZZ Remote" }).click();
  await founder.getByRole("menuitem", { name: "Check in from anywhere (remote)" }).click();
  await expect.poll(() => sql(`select attendance_mode from ops.staff where email = '${REMOTE}'`)).toBe("remote");
  await expect(founder.getByRole("row").filter({ hasText: "ZZ Remote" }).getByText("Works remotely")).toBeVisible();
  await expect(founder.getByRole("row").filter({ hasText: "ZZ Office" }).getByText("Works from office")).toBeVisible();
});

test("a remote person checks in with no office network and checks out", async ({ browser }) => {
  const page = await signedIn(browser, REMOTE);
  await chip(page, "You are not checked in").getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Checked in. Have a good day.")).toBeVisible();
  await expect(chip(page, "You are checked in")).toBeVisible();
  await expect(page.getByText("Checked in. Have a good day.")).toBeHidden({ timeout: 15_000 });
  expect(sql(`select in_source from ops.attendance_session where staff_id = '${staffId(REMOTE)}'`)).toBe("remote");
  expect(sql(`select count(*) from ops.attendance_failure`)).toBe("0");
  await chip(page, "You are checked in").getByRole("button", { name: "Check out" }).click();
  await expect(page.getByText("Checked out. See you tomorrow.")).toBeVisible();
  expect(sql(`select out_source from ops.attendance_session where staff_id = '${staffId(REMOTE)}'`)).toBe("remote");
});

test("an office-mode person is still refused without an office network", async ({ browser }) => {
  const page = await signedIn(browser, OFFICE);
  await chip(page, "You are not checked in").getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("This device isn't on the office network", { exact: false }).first()).toBeVisible();
  expect(sql(`select count(*) from ops.attendance_session where staff_id = '${staffId(OFFICE)}'`)).toBe("0");
  expect(sql(`select count(*) from ops.attendance_failure`)).toBe("1");
});
