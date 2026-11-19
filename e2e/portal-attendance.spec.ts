import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// The monthly attendance screen in My space (0030) on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "pa-founder@hardcode.local";
const TRACKED = "pa-tracked@hardcode.local";
const UNTRACKED = "pa-untracked@hardcode.local";

test.describe.configure({ mode: "serial" });

// The whole of last month is in the past, so the figures below do not depend on the day the test runs.
const now = new Date();
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const pad = (n: number) => String(n).padStart(2, "0");
const MONTH = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`;
const DAYS = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
const LABEL = prev.toLocaleString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
const day = (n: number) => `${MONTH}-${pad(n)}`;

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const cell = (page: Page, date: string) => page.locator(`[data-slot="calendar-day"][data-value="${date}"]`);

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${TRACKED}', 'ZZ Tracked', 'member', '{sales}'),
    ('${UNTRACKED}', 'ZZ Untracked', 'member', '{sales}')`);
  for (const email of [FOUNDER, TRACKED, UNTRACKED]) createPasswordUser(email, PASSWORD);
  for (const email of [TRACKED, UNTRACKED]) await (await signedIn(browser, email)).context().close();

  // Every day counts as a working day, flags are on, and checking in started on the 2nd of last month.
  sql(`update ops.office_settings set work_days = '{1,2,3,4,5,6,7}', flags_on = true`);
  sql(`alter table ops.staff disable trigger t_staff_office_tag;
       update ops.staff set works_from_office = true, office_since = '${day(2)}' where email = '${TRACKED}';
       alter table ops.staff enable trigger t_staff_office_tag;`);
  const who = `(select id from ops.staff where email = '${TRACKED}')`;
  const at = (date: string, time: string) => `timestamptz '${date} ${time}+05:30'`;
  sql(`insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source, is_late, late_minutes) values
    (${who}, '${day(2)}', ${at(day(2), "11:00")}, ${at(day(2), "17:00")}, 'network', 'network', false, 0),
    (${who}, '${day(3)}', ${at(day(3), "11:40")}, ${at(day(3), "17:00")}, 'network', 'network', true, 25),
    (${who}, '${day(7)}', ${at(day(7), "11:00")}, ${at(day(7), "17:00")}, 'remote', 'remote', false, 0)`);
  sql(`insert into ops.office_holiday (holiday_date, name) values ('${day(5)}', 'ZZ Founders Day')`);
});

test("a tracked person sees last month with the day figures on a calendar", async ({ browser }) => {
  const page = await signedIn(browser, TRACKED);
  await page.goto("/me");
  await page.getByRole("tab", { name: "Attendance" }).click();
  await expect(page).toHaveURL(/\/me\/attendance$/);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page).toHaveURL(new RegExp(`month=${MONTH}$`));
  await expect(page.getByRole("heading", { name: LABEL, level: 2 }).first()).toBeVisible();

  const summary = page.getByRole("region", { name: "Month summary" });
  await expect(summary).toContainText(/Days present\s*3/);
  await expect(summary).toContainText(/Late arrivals\s*1/);
  await expect(summary).toContainText(new RegExp(`Absent days\\s*${DAYS - 5}`));
  await expect(summary).toContainText(/Hours worked\s*17h 20m/);
  await expect(summary).toContainText(/5h 47m a day on average/);
  await expect(summary).toContainText(/1 holiday this month/);
  await expect(summary).toContainText(/1 from outside the office/);

  await expect(cell(page, day(2))).toContainText("Present");
  await expect(cell(page, day(3))).toContainText("Late");
  await expect(cell(page, day(5))).toContainText("Holiday");
  await expect(cell(page, day(7))).toContainText("Present");
  await expect(cell(page, day(4))).toContainText("Absent");
  await expect(cell(page, day(1))).not.toContainText("Absent");
});

test("the day-by-day table carries every figure and a screen reader can name each day", async ({ browser }) => {
  const page = await signedIn(browser, TRACKED);
  await page.goto(`/me/attendance?month=${MONTH}`);
  const table = page.getByRole("table", { name: `Attendance for ${LABEL}` });
  const late = table.getByRole("row").filter({ hasText: "25 min late" });
  await expect(late).toContainText("11:40 am");
  await expect(late).toContainText("5:00 pm");
  await expect(late).toContainText("5h 20m");
  await expect(table.getByRole("row").filter({ hasText: "ZZ Founders Day" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Remote" })).toContainText("6h 00m");
  await expect(page.getByRole("gridcell", { name: new RegExp(`${day(3)}.*25 min late`) })).toBeVisible();
});

test("the calendar works from the keyboard and does not change anything", async ({ browser }) => {
  const page = await signedIn(browser, TRACKED);
  await page.goto(`/me/attendance?month=${MONTH}`);
  await page.waitForLoadState("networkidle");
  await cell(page, day(10)).focus();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, day(11))).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, day(18))).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cell(page, day(18))).not.toHaveAttribute("data-selected", /.*/);
  expect(sql(`select count(*) from ops.attendance_session`)).toBe("3");
});

test("the month can be downloaded as a spreadsheet and printed as a statement", async ({ browser }) => {
  const page = await signedIn(browser, TRACKED);
  const res = await page.request.get(`/me/attendance/export?month=${MONTH}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv.split("\r\n")[0]).toBe("Date,Day,Status,In,Out,Worked,Note");
  expect(csv).toMatch(new RegExp(`${day(3)},\\w{3},25 min late,11:40 am,5:00 pm,5h 20m,`));
  expect(csv).toContain(`${day(5)}`);
  expect(csv).toContain("ZZ Founders Day");
  expect(csv).toMatch(new RegExp(`${day(7)},\\w{3},Present,11:00 am,5:00 pm,6h 00m,Remote`));

  await page.goto(`/me/attendance?month=${MONTH}`);
  await page.getByRole("link", { name: "Statement" }).click();
  await expect(page).toHaveURL(new RegExp(`/me/attendance/statement\\?month=${MONTH}$`));
  const statement = page.getByRole("article", { name: `Attendance statement, ${LABEL}` });
  await expect(statement).toContainText("ZZ Tracked");
  await expect(statement).toContainText("pa-tracked@hardcode.local");
  await expect(statement.getByRole("table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
});

test("someone who does not check in sees a plain message and gets no export", async ({ browser }) => {
  const page = await signedIn(browser, UNTRACKED);
  await page.goto("/me/attendance");
  await expect(page.getByText("Attendance is not switched on for you yet.")).toBeVisible();
  const res = await page.request.get(`/me/attendance/export?month=${MONTH}`);
  expect(res.status()).toBe(403);
});

test("a bad month in the address falls back to the current month", async ({ browser }) => {
  const page = await signedIn(browser, TRACKED);
  await page.goto("/me/attendance?month=2026-13");
  const thisMonth = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" });
  await expect(page.getByRole("heading", { name: thisMonth, level: 2 }).first()).toBeVisible();
});
