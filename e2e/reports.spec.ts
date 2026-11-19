import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Reports on the LOCAL stack only. All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "rp-founder@hardcode.local";
const HRPERSON = "rp-hr@hardcode.local";
const MEMBER = "rp-member@hardcode.local";

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
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER]) createPasswordUser(email, PASSWORD);
  for (const email of [FOUNDER, HRPERSON, MEMBER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
  sql(`insert into ops.institution (name, kind, city, district) values ('=ZZ Sheet College', 'engineering_college', 'Pune', 'Pune')`);
  sql(`insert into ops.deal (institution_id, kind, title, stage, value_inr, probability, expected_close, owner_id)
       select i.id, 'fdp', 'ZZ Report Deal', 'proposal', 200000, 50, (date_trunc('month', now() at time zone 'Asia/Kolkata')::date + 9), s.id
       from ops.institution i, ops.staff s where i.name = '=ZZ Sheet College' and s.email = '${FOUNDER}'`);
});

test("the founder sees every report, reads the pipeline and downloads it safely", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  const list = page.getByRole("list", { name: "Reports" });
  for (const title of ["Pipeline and forecast", "Institutions by stage", "Task timeliness", "Time logged", "Attendance summary", "Leave summary"]) {
    await expect(list.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  }

  await list.getByRole("link", { name: /Pipeline and forecast/ }).click();
  await expect(page).toHaveURL(/\/reports\/pipeline$/);
  const table = page.getByRole("table", { name: "Pipeline and forecast" });
  await expect(table.getByRole("row", { name: /ZZ Report Deal/ })).toContainText("2,00,000");
  await expect(table.getByRole("row", { name: /ZZ Report Deal/ })).toContainText("1,00,000");
  await expect(table.getByRole("row", { name: /^Total/ })).toContainText("1 deal");
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();

  const res = await page.request.get(page.url().replace(/\/reports\/pipeline.*/, "") + (await page.getByRole("link", { name: "Download CSV" }).getAttribute("href")));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  const bytes = await res.body();
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8");
  expect(text).toContain("Institution,Deal,Stage,Owner,Expected close,Value,Chance,Weighted value");
  expect(text).toContain("'=ZZ Sheet College,ZZ Report Deal,Proposal");
  expect(text).not.toMatch(/(^|,)=ZZ/m);
  await page.context().close();
});

test("the dates narrow the report, and a backwards or unreal range does not break it", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/reports/pipeline?from=2020-01-01&to=2020-01-31");
  await expect(page.getByText("Nothing to report for these dates.")).toBeVisible();
  await page.goto("/reports/pipeline?from=2020-02-31&to=garbage");
  await expect(page.getByRole("table", { name: "Pipeline and forecast" })).toBeVisible();
  await page.locator("#rp-from").fill("2020-03-01");
  await page.locator("#rp-to").fill("2020-03-31");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/from=2020-03-01&to=2020-03-31/);
  await expect(page.getByText("Nothing to report for these dates.")).toBeVisible();
  await page.goto("/reports/nonsense");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.context().close();
});

test("the other reports load for the founder", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  for (const [key, title] of [["institutions", "Institutions by stage"], ["timeliness", "Task timeliness"], ["time", "Time logged"], ["attendance", "Attendance summary"], ["leave", "Leave summary"]]) {
    await page.goto(`/reports/${key}`);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText(/Couldn.t load/)).toHaveCount(0);
  }
  await page.goto("/reports/institutions");
  await expect(page.getByRole("table", { name: "Institutions by stage" }).getByRole("row", { name: /^Prospect/ })).toContainText("1");
  await page.context().close();
});

test("an HR person gets attendance and leave only", async ({ browser }) => {
  const page = await signedIn(browser, HRPERSON);
  await page.goto("/reports");
  const list = page.getByRole("list", { name: "Reports" });
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(list.getByRole("link", { name: /Leave summary/ })).toBeVisible();
  await page.goto("/reports/pipeline");
  await expect(page.getByText("You don't have access to this report")).toBeVisible();
  const denied = await page.request.get("/reports/pipeline/export");
  expect(denied.status()).toBe(403);
  const ok = await page.request.get("/reports/leave/export");
  expect(ok.status()).toBe(200);
  await page.context().close();
});

test("a plain member has no Reports entry, page or download", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/reports");
  await expect(page.getByText("You don't have access to Reports")).toBeVisible();
  expect((await page.request.get("/reports/leave/export")).status()).toBe(403);
  await expect(page.locator('[data-sidebar="content"]').getByRole("link", { name: "Reports" })).toHaveCount(0);
  await page.context().close();
});

test("a signed-out visitor cannot download a report", async ({ request }) => {
  const res = await request.get("/reports/leave/export", { maxRedirects: 0 });
  expect([307, 308, 401, 403]).toContain(res.status());
});
