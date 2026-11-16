import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Outreach workspace on the LOCAL stack only (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "out-founder@hardcode.local";
const PARTNER = "out-partner@hardcode.local";
const VIEWER = "out-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const tomorrow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86_400_000));
const one = (q: string) => sql(q);

async function pickInstitution(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Institution" }).click();
  await page.getByPlaceholder("Type a name or city…").fill(name);
  await page.getByRole("option", { name }).click();
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${PARTNER}', 'ZZ Partner', 'partner', '{}'), ('${VIEWER}', 'ZZ Viewer', 'viewer', '{outreach}')`);
  for (const email of [FOUNDER, PARTNER, VIEWER]) createPasswordUser(email, PASSWORD);
  // The partner's staff row is created when they first sign in.
  await (await signedIn(browser, PARTNER)).context().close();
  sql(`insert into ops.institution (name, kind, city, district) values
    ('ZZ Qualify College', 'polytechnic', 'Pune', 'Pune'),
    ('ZZ Untouched School', 'school', 'Nashik', 'Nashik'),
    ('ZZ Hands Off College', 'engineering_college', 'Nagpur', 'Nagpur')`);
  sql(`insert into ops.institution (name, kind, city, district, owner_id)
       select 'ZZ Partner School', 'school', 'Satara', 'Satara', id from ops.staff where email = '${PARTNER}'`);
});

test("a qualified visit opens a deal, creates a follow-up, and the follow-up can be completed", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/outreach");
  await expect(page.getByText("No open follow-ups")).toBeVisible();

  await page.getByRole("button", { name: "Log activity" }).first().click();
  await pickInstitution(page, "ZZ Qualify College");
  await page.getByRole("combobox", { name: "Outcome" }).click();
  await page.getByRole("option", { name: "Qualified" }).click();
  await expect(page.getByText("opens a Workshop deal at Meeting")).toBeVisible();
  await page.getByLabel("Notes").fill("ZZ met the principal");
  await page.getByLabel("Next step").fill("ZZ send proposal");
  await page.getByLabel("Due").fill(tomorrow());
  await page.getByRole("dialog").getByRole("button", { name: "Log activity" }).click();
  await expect(page.getByText("Activity logged")).toBeVisible();

  expect(one("select stage from ops.institution where name = 'ZZ Qualify College'")).toBe("qualified");
  expect(one("select count(*) || ':' || min(d.stage) || ':' || min(d.kind) from ops.deal d join ops.institution i on i.id = d.institution_id where i.name = 'ZZ Qualify College'")).toBe("1:meeting:workshop");
  expect(one("select count(*) from ops.task where template = 'follow_up' and title = 'ZZ send proposal'")).toBe("1");

  await page.reload();
  await expect(page.getByText("ZZ send proposal")).toBeVisible();
  await expect(page.getByRole("link", { name: "ZZ Qualify College" })).toBeVisible();
  await page.getByRole("button", { name: "Done: ZZ send proposal" }).click();
  await expect(page.getByText("ZZ send proposal")).toBeHidden();
  expect(one("select status from ops.task where title = 'ZZ send proposal'")).toBe("done");

  await page.goto("/outreach?tab=history");
  await expect(page.getByText("ZZ met the principal")).toBeVisible();
});

test("a next step without a due date is refused next to the field", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/outreach");
  await page.getByRole("button", { name: "Log activity" }).first().click();
  await pickInstitution(page, "ZZ Hands Off College");
  await page.getByLabel("Next step").fill("ZZ call back");
  await page.getByRole("dialog").getByRole("button", { name: "Log activity" }).click();
  await expect(page.getByText("Pick a due date so a follow-up task is created.")).toBeVisible();
  expect(one("select count(*) from ops.activity a join ops.institution i on i.id = a.institution_id where i.name = 'ZZ Hands Off College'")).toBe("0");
});

test("the territory list shows untouched institutions and filters by last touch", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/outreach?tab=territory&touch=untouched");
  await expect(page.getByRole("link", { name: "ZZ Untouched School" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ZZ Qualify College" })).toBeHidden();

  await page.goto("/outreach?tab=territory&segment=school");
  await expect(page.getByRole("link", { name: "ZZ Untouched School" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ZZ Qualify College" })).toBeHidden();

  await page.goto("/outreach?tab=territory&district=Pune");
  await expect(page.getByRole("link", { name: "ZZ Qualify College" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ZZ Untouched School" })).toBeHidden();
});

test("logging from the Institution 360 moves a prospect to contacted", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/institutions");
  await page.getByRole("link", { name: "ZZ Untouched School" }).click();
  await page.getByRole("tab", { name: "Activities" }).click();
  await page.getByRole("button", { name: "Log activity" }).click();
  await page.getByRole("combobox", { name: "What did you do?" }).click();
  await page.getByRole("option", { name: "Call" }).click();
  await page.getByRole("combobox", { name: "Outcome" }).click();
  await page.getByRole("option", { name: "Interested", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log activity" }).click();
  await expect(page.getByText("Activity logged")).toBeVisible();
  expect(one("select stage from ops.institution where name = 'ZZ Untouched School'")).toBe("contacted");
  await expect(page.getByLabel("Recent activities").getByText("Call")).toBeVisible();
});

test("a partner logs only for their own institution and sees only their own activity", async ({ browser }) => {
  const page = await signedIn(browser, PARTNER);
  await page.goto("/outreach");
  await page.getByRole("button", { name: "Log activity" }).first().click();
  await page.getByRole("combobox", { name: "Institution" }).click();
  await page.getByPlaceholder("Type a name or city…").fill("ZZ");
  await expect(page.getByRole("option", { name: "ZZ Partner School" })).toBeVisible();
  await expect(page.getByRole("option", { name: "ZZ Hands Off College" })).toBeHidden();
  await page.getByRole("option", { name: "ZZ Partner School" }).click();
  await page.getByLabel("Notes").fill("ZZ partner visit");
  await page.getByLabel("Next step").fill("ZZ partner follow-up");
  await page.getByLabel("Due").fill(tomorrow());
  await page.getByRole("dialog").getByRole("button", { name: "Log activity" }).click();
  await expect(page.getByText("Activity logged")).toBeVisible();

  await page.reload();
  await expect(page.getByText("ZZ partner follow-up")).toBeVisible();
  await page.getByRole("button", { name: "Done: ZZ partner follow-up" }).click();
  await expect(page.getByText("ZZ partner follow-up")).toBeHidden();
  expect(one("select status from ops.task where title = 'ZZ partner follow-up'")).toBe("done");

  await page.goto("/outreach?tab=history&scope=all");
  await expect(page.getByText("ZZ partner visit")).toBeVisible();
  await expect(page.getByText("ZZ met the principal")).toBeHidden();
});

test("a viewer can read Outreach but has no Log activity button", async ({ browser }) => {
  const page = await signedIn(browser, VIEWER);
  await page.goto("/outreach?tab=history&scope=all");
  await expect(page.getByText("ZZ met the principal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log activity" })).toBeHidden();
});
