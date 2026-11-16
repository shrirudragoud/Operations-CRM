import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Sales workspace on the LOCAL stack only (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "sales-founder@hardcode.local";
const PARTNER = "sales-partner@hardcode.local";
const VIEWER = "sales-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const one = (q: string) => sql(q);

async function pickInstitution(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Institution" }).click();
  await page.getByPlaceholder("Type a name or city…").fill(name);
  await page.getByRole("option", { name }).click();
}

async function chooseKind(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Deal type" }).click();
  await page.getByRole("option", { name: label }).click();
}

async function moveTo(page: Page, dealTitle: string, item: string) {
  await page.getByRole("button", { name: `Move ${dealTitle}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${PARTNER}', 'ZZ Partner', 'partner', '{}'), ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, PARTNER, VIEWER]) createPasswordUser(email, PASSWORD);
  await (await signedIn(browser, PARTNER)).context().close();
  sql(`insert into ops.institution (name, kind, city, district) values
    ('ZZ Won College', 'engineering_college', 'Pune', 'Pune'),
    ('ZZ Lab School', 'school', 'Nashik', 'Nashik'),
    ('ZZ Other College', 'polytechnic', 'Nagpur', 'Nagpur')`);
  sql(`insert into ops.institution (name, kind, city, district, owner_id)
       select 'ZZ Partner School', 'school', 'Satara', 'Satara', id from ops.staff where email = '${PARTNER}'`);
});

test("the founder opens a deal and takes it from meeting to won, which creates an event and two tasks", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/sales");
  await page.getByRole("button", { name: "New deal" }).click();
  await pickInstitution(page, "ZZ Won College");
  await page.getByLabel("Value (INR)").fill("50000");
  await page.getByRole("dialog").getByRole("button", { name: "Open deal" }).click();
  await expect(page.getByText("Deal opened at Meeting")).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Workshop - ZZ Won College" })).toBeVisible();
  expect(one("select stage || ':' || value_inr || ':' || probability from ops.deal where title = 'Workshop - ZZ Won College'")).toBe("meeting:50000.00:10");

  await moveTo(page, "Workshop - ZZ Won College", "Proposal");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect(page.getByText("Moved to Proposal")).toBeVisible();
  await expect.poll(() => one("select stage from ops.deal where title = 'Workshop - ZZ Won College'")).toBe("proposal");

  await moveTo(page, "Workshop - ZZ Won College", "Negotiation");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => one("select stage from ops.deal where title = 'Workshop - ZZ Won College'")).toBe("negotiation");

  await moveTo(page, "Workshop - ZZ Won College", "Mark won");
  await expect(page.getByText("Winning is final and cannot be undone.")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("A draft event for Workshop to schedule")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Mark won" }).click();
  await expect(page.getByText("Deal won", { exact: true })).toBeVisible();
  await expect.poll(() => one("select stage from ops.deal where title = 'Workshop - ZZ Won College'")).toBe("won");

  expect(one("select count(*) from ops.event e join ops.deal d on d.id = e.deal_id where d.title = 'Workshop - ZZ Won College'")).toBe("1");
  expect(one("select string_agg(template, ',' order by template) from ops.task t join ops.event e on t.entity_type = 'event' and t.entity_id = e.id join ops.deal d on d.id = e.deal_id where d.title = 'Workshop - ZZ Won College'")).toBe("reserve_kits,trainer_request");
  expect(one("select stage from ops.institution where name = 'ZZ Won College'")).toBe("deal_won");
  await page.reload();
  await expect(page.getByText("Winning created:")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move / })).toBeHidden();
});

test("a second open deal of the same type is refused, a different type is accepted", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/sales");
  await page.getByRole("button", { name: "New deal" }).click();
  await pickInstitution(page, "ZZ Lab School");
  await page.getByRole("dialog").getByRole("button", { name: "Open deal" }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);

  await page.goto("/sales");
  await page.getByRole("button", { name: "New deal" }).click();
  await pickInstitution(page, "ZZ Lab School");
  await page.getByRole("dialog").getByRole("button", { name: "Open deal" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(/already has an open Workshop deal/i);
  expect(one("select count(*) from ops.deal d join ops.institution i on i.id = d.institution_id where i.name = 'ZZ Lab School'")).toBe("1");

  await chooseKind(page, "Lab deal");
  await page.getByRole("dialog").getByRole("button", { name: "Open deal" }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  expect(one("select count(*) from ops.deal d join ops.institution i on i.id = d.institution_id where i.name = 'ZZ Lab School'")).toBe("2");
});

test("a lost deal needs a reason and can be reopened to meeting", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/sales");
  await expect(page.getByRole("link", { name: /Workshop - ZZ Lab School/ })).toBeVisible();
  await moveTo(page, "Workshop - ZZ Lab School", "Mark lost");
  await page.getByRole("dialog").getByRole("button", { name: "Mark lost" }).click();
  await expect(page.getByText("Say why the deal was lost.")).toBeVisible();
  expect(one("select stage from ops.deal where title = 'Workshop - ZZ Lab School'")).toBe("meeting");

  await page.getByLabel("Why was it lost?").fill("ZZ budget went to another vendor");
  await page.getByRole("dialog").getByRole("button", { name: "Mark lost" }).click();
  await expect.poll(() => one("select stage || ':' || lost_reason from ops.deal where title = 'Workshop - ZZ Lab School'")).toBe("lost:ZZ budget went to another vendor");

  await page.goto("/sales");
  await moveTo(page, "Workshop - ZZ Lab School", "Meeting");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => one("select stage from ops.deal where title = 'Workshop - ZZ Lab School'")).toBe("meeting");
});

test("winning a lab deal creates one planning task", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/sales");
  const title = "Lab deal - ZZ Lab School";
  await moveTo(page, title, "Proposal");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => one(`select stage from ops.deal where title = '${title}'`)).toBe("proposal");
  await page.goto("/sales");
  await moveTo(page, title, "Negotiation");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => one(`select stage from ops.deal where title = '${title}'`)).toBe("negotiation");
  await page.goto("/sales");
  await moveTo(page, title, "Mark won");
  await expect(page.getByRole("dialog").getByText("A task for Workshop to plan the lab setup")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Mark won" }).click();
  await expect.poll(() => one(`select stage from ops.deal where title = '${title}'`)).toBe("won");
  expect(one(`select count(*) || ':' || min(template) from ops.task t join ops.deal d on t.entity_type = 'deal' and t.entity_id = d.id where d.title = '${title}'`)).toBe("1:plan_lab_setup");
});

test("proposal lines save, total up and can set the deal value", async ({ browser }) => {
  sql(`insert into ops.deal (institution_id, kind, title, stage, owner_id)
       select i.id, 'fdp', 'ZZ Lines Deal', 'meeting', s.id from ops.institution i, ops.staff s
       where i.name = 'ZZ Other College' and s.email = '${FOUNDER}'`);
  const id = one("select id from ops.deal where title = 'ZZ Lines Deal'");
  const page = await signedIn(browser, FOUNDER);
  await page.goto(`/sales/${id}`);
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Line 1 description").fill("ZZ kits");
  await page.getByLabel("Line 1 quantity").fill("10");
  await page.getByLabel("Line 1 unit price").fill("1500");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Line 2 description").fill("ZZ trainer day");
  await page.getByLabel("Line 2 quantity").fill("2");
  await page.getByLabel("Line 2 unit price").fill("5000");
  await expect(page.getByText(/Total .*25,000/)).toBeVisible();
  await page.getByRole("button", { name: "Save lines" }).click();
  await expect(page.getByText("Lines saved")).toBeVisible();
  expect(one("select count(*) || ':' || sum(qty * unit_price_inr) from ops.deal_line l join ops.deal d on d.id = l.deal_id where d.title = 'ZZ Lines Deal'")).toBe("2:25000.00");

  await page.reload();
  await expect(page.getByLabel("Line 1 description")).toHaveValue("ZZ kits");
  await expect(page.getByLabel("Line 2 description")).toHaveValue("ZZ trainer day");
  await page.getByRole("button", { name: "Use lines total as deal value" }).click();
  await expect.poll(() => one("select value_inr from ops.deal where title = 'ZZ Lines Deal'")).toBe("25000.00");

  await page.getByLabel("Line 2 description").fill("");
  await page.getByRole("button", { name: "Save lines" }).click();
  await expect(page.getByText("Describe the line.")).toBeVisible();
});

test("the Institution 360 lists its deals and can open a new one", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/institutions");
  await page.getByRole("link", { name: "ZZ Won College" }).click();
  await page.getByRole("tab", { name: "Deals" }).click();
  await expect(page.getByRole("link", { name: "Workshop - ZZ Won College" })).toBeVisible();
  await page.getByRole("button", { name: "New deal" }).click();
  await expect(page.getByRole("dialog").getByText("ZZ Won College")).toBeVisible();
  await chooseKind(page, "Other");
  await page.getByRole("dialog").getByRole("button", { name: "Open deal" }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Other - ZZ Won College" })).toBeVisible();
});

test("the reports tab shows the forecast, pipeline by type and the funnel", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/sales?tab=reports");
  await expect(page.getByRole("region", { name: "Forecast summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pipeline by deal type" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Forecast by expected close" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Institution funnel" })).toBeVisible();
  await page.goto("/sales?tab=partners");
  await expect(page.getByText("ZZ Partner")).toBeVisible();
});

test("a partner sees and edits only their own deals and cannot mark won", async ({ browser }) => {
  const page = await signedIn(browser, PARTNER);
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "My deals" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ZZ Won College/ })).toBeHidden();
  await expect(page.getByRole("link", { name: "Partners" })).toBeHidden();

  await page.getByRole("button", { name: "New deal" }).click();
  await page.getByRole("combobox", { name: "Institution" }).click();
  await page.getByPlaceholder("Type a name or city…").fill("ZZ");
  await expect(page.getByRole("option", { name: "ZZ Partner School" })).toBeVisible();
  await expect(page.getByRole("option", { name: "ZZ Other College" })).toBeHidden();
  await page.getByRole("option", { name: "ZZ Partner School" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open deal" }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);

  const title = "Workshop - ZZ Partner School";
  await page.goto("/sales");
  await moveTo(page, title, "Proposal");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => one(`select stage from ops.deal where title = '${title}'`)).toBe("proposal");
  await page.goto("/sales");
  await moveTo(page, title, "Negotiation");
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(() => one(`select stage from ops.deal where title = '${title}'`)).toBe("negotiation");
  await page.goto("/sales");
  await page.getByRole("button", { name: `Move ${title}` }).click();
  await expect(page.getByRole("menuitem", { name: "Mark won" })).toBeHidden();
  await expect(page.getByRole("menuitem", { name: "Mark lost" })).toBeVisible();
  await page.keyboard.press("Escape");

  const other = one("select id from ops.deal where title = 'Other - ZZ Won College'");
  await page.goto(`/sales/${other}`);
  await expect(page.getByText("Deal not found")).toBeVisible();
});

test("a viewer can read the board and a won deal but has no controls", async ({ browser }) => {
  const page = await signedIn(browser, VIEWER);
  await page.goto("/sales");
  await expect(page.getByRole("link", { name: /Other - ZZ Won College/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "New deal" })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);

  const id = one("select id from ops.deal where title = 'Other - ZZ Won College'");
  await page.goto(`/sales/${id}`);
  await expect(page.getByRole("button", { name: "Save details" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Save lines" })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Move / })).toBeHidden();
});
