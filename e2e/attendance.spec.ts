import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Attendance (0023) on the LOCAL stack only (see playwright.config.ts). Local Kong puts the caller in
// x-forwarded-for, so the test points the setting at that header; on the live site it is cf-connecting-ip.
const PASSWORD = "correct-horse-battery";
const FOUNDER = "at-founder@hardcode.local";
const LEAD = "at-lead@hardcode.local";
const MEMBER = "at-member@hardcode.local";
const OTHER = "at-other@hardcode.local";

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
    ('${LEAD}', 'ZZ Lead', 'dept_lead', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{sales}'),
    ('${OTHER}', 'ZZ Other', 'member', '{sales}')`);
  for (const email of [FOUNDER, LEAD, MEMBER, OTHER]) createPasswordUser(email, PASSWORD);
  for (const email of [LEAD, MEMBER, OTHER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.office_settings set ip_header = 'x-forwarded-for', ip_hops = 1`);
});

test("the founder tags a person, and only that person gets the check-in button", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/team");
  await founder.getByRole("button", { name: "Actions for ZZ Member" }).click();
  await founder.getByRole("menuitem", { name: /Track attendance/ }).click();
  await expect(founder.getByText("ZZ Member now checks in at the office")).toBeVisible();
  expect(sql(`select works_from_office from ops.staff where email = '${MEMBER}'`)).toBe("t");

  const member = await signedIn(browser, MEMBER);
  await expect(chip(member, "You are not checked in")).toBeVisible();
  await expect(member.getByRole("link", { name: "Attendance", exact: true })).toBeVisible();

  const other = await signedIn(browser, OTHER);
  await expect(other.getByRole("status", { name: /checked in/ })).toHaveCount(0);
  await other.goto("/attendance");
  await expect(other.getByText("You don't have access to attendance")).toBeVisible();
});

test("check-in is refused until the founder trusts the network, then works, and check-out closes it", async ({ browser }) => {
  const member = await signedIn(browser, MEMBER);
  await chip(member, "You are not checked in").getByRole("button", { name: "Check in" }).click();
  await expect(member.getByText("This device isn't on the office network", { exact: false }).first()).toBeVisible();
  expect(sql(`select count(*) from ops.attendance_failure`)).toBe("1");

  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/attendance?tab=settings");
  await founder.getByRole("button", { name: "Trust this network" }).click();
  await expect(founder.getByText("This connection is now an office network.")).toBeVisible();
  expect(sql(`select count(*) from ops.office_network where is_active`)).toBe("1");

  await member.reload();
  await chip(member, "You are not checked in").getByRole("button", { name: "Check in" }).click();
  await expect(member.getByText("Checked in. Have a good day.")).toBeVisible();
  await expect(chip(member, "You are checked in")).toBeVisible();
  expect(sql(`select count(*) from ops.attendance_session where staff_id = '${staffId(MEMBER)}' and check_out_at is null`)).toBe("1");
  await member.getByRole("button", { name: "Close toast" }).click();
  await expect(member.getByText("Checked in. Have a good day.")).toBeHidden();

  await chip(member, "You are checked in").getByRole("button", { name: "Check out" }).click();
  await expect(member.getByText("Checked out. See you tomorrow.")).toBeVisible();
  await expect(chip(member, "You are not checked in")).toBeVisible();
  expect(sql(`select count(*) from ops.attendance_session where staff_id = '${staffId(MEMBER)}' and check_out_at is not null and out_source = 'network'`)).toBe("1");

  await member.goto("/attendance");
  await expect(member.getByText("Each day", { exact: true })).toBeVisible();
});

test("a lead approves a request for time, and it shows on the person's week", async ({ browser }) => {
  const yesterday = sql(`select (ops.today_ist() - 1)::text`);
  sql(`insert into ops.attendance_request (staff_id, work_date, in_time, out_time, reason)
       values ('${staffId(MEMBER)}', '${yesterday}', '11:00', '17:00', 'ZZ phone was on mobile data')`);

  const lead = await signedIn(browser, LEAD);
  await lead.goto("/attendance?tab=requests");
  await expect(lead.getByText("ZZ phone was on mobile data")).toBeVisible();
  await lead.getByRole("button", { name: "Approve" }).click();
  await expect(lead.getByText("Approved for ZZ Member")).toBeVisible();
  expect(sql(`select count(*) from ops.attendance_session where staff_id = '${staffId(MEMBER)}' and in_source = 'manual'`)).toBe("1");

  await lead.goto("/attendance?tab=team");
  await expect(lead.getByRole("cell", { name: "ZZ Member" })).toBeVisible();
});

test("the founder turns on late and absent flags", async ({ browser }) => {
  const founder = await signedIn(browser, FOUNDER);
  await founder.goto("/attendance?tab=settings");
  await expect(founder.getByText("Trial period")).toBeVisible();
  await founder.getByRole("switch", { name: /Show late, early and absent/ }).click();
  await founder.getByRole("button", { name: "Save settings" }).click();
  await expect(founder.getByText("Office settings saved")).toBeVisible();
  expect(sql(`select flags_on from ops.office_settings`)).toBe("t");
  await founder.reload();
  await expect(founder.getByText("Trial period")).toHaveCount(0);
});
