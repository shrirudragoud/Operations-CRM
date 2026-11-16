import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Institutions workspace on the LOCAL stack only (see playwright.config.ts). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "inst-founder@hardcode.local";
const PARTNER = "inst-partner@hardcode.local";
const VIEWER = "inst-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const count = () => Number(sql("select count(*) from ops.institution"));

test.beforeAll(() => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${PARTNER}', 'ZZ Partner', 'partner', '{}'), ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, PARTNER, VIEWER]) createPasswordUser(email, PASSWORD);
});

test("founder creates, edits, archives and restores an institution", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/institutions");
  await expect(page.getByText("No institutions yet")).toBeVisible();

  await page.getByRole("link", { name: "New institution" }).first().click();
  // Choosing a kind needs hydrated JS, so do it first; typing earlier would be wiped by hydration.
  await page.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "Engineering college" }).click();
  await page.getByLabel("Name").fill("ZZ Test College");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create institution" }).click();

  await expect(page.getByRole("heading", { name: "ZZ Test College" })).toBeVisible();
  await expect(page.getByText("Prospect").first()).toBeVisible();

  // A second institution with the same name and city is refused next to the name field.
  await page.goto("/institutions/new");
  await page.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "School" }).click();
  await page.getByLabel("Name").fill("ZZ Test College");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create institution" }).click();
  await expect(page.getByText("That institution already exists").first()).toBeVisible();
  expect(count()).toBe(1);

  await page.goto("/institutions");
  await page.getByRole("link", { name: "ZZ Test College" }).click();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("City").fill("Nashik");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Nashik", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("This institution is archived")).toBeVisible();
  expect(sql("select count(*) from ops.institution where archived_at is not null")).toBe("1");

  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("This institution is archived")).toBeHidden();
  expect(sql("select count(*) from ops.institution where archived_at is not null")).toBe("0");
});

test("founder manages contacts on the 360 page", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/institutions");
  await page.getByRole("link", { name: "ZZ Test College" }).click();
  await page.getByRole("tab", { name: /Contacts/ }).click();
  await page.getByRole("button", { name: "Add contact" }).first().click();
  await page.getByLabel("Name").fill("ZZ Principal");
  await page.getByLabel("Email").fill("zz@example.invalid");
  await page.getByRole("button", { name: "Add contact" }).last().click();
  await expect(page.getByRole("cell", { name: "ZZ Principal", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove ZZ Principal" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("cell", { name: "ZZ Principal", exact: true })).toBeHidden();
});

test("a partner sees only their own institution and cannot archive it", async ({ browser }) => {
  const partner = await signedIn(browser, PARTNER);
  sql(`insert into ops.institution (name, kind, city, owner_id)
       values ('ZZ Partner School', 'school', 'Pune', (select id from ops.staff where email = '${PARTNER}'))`);

  await partner.goto("/institutions");
  await expect(partner.getByRole("link", { name: "ZZ Partner School" })).toBeVisible();
  await expect(partner.getByRole("link", { name: "ZZ Test College" })).toHaveCount(0);

  const otherId = sql("select id from ops.institution where name = 'ZZ Test College'");
  await partner.goto(`/institutions/${otherId}`);
  await expect(partner.getByText("Institution not found")).toBeVisible();

  await partner.goto("/institutions");
  await partner.getByRole("link", { name: "ZZ Partner School" }).click();
  await expect(partner.getByRole("heading", { name: "ZZ Partner School" })).toBeVisible();
  await expect(partner.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(partner.getByRole("button", { name: "Correct stage" })).toHaveCount(0);
});

test("a viewer sees the list but no create or edit controls", async ({ browser }) => {
  const viewer = await signedIn(browser, VIEWER);
  await viewer.goto("/institutions");
  await expect(viewer.getByRole("link", { name: "ZZ Test College" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "New institution" })).toHaveCount(0);
  await expect(viewer.getByRole("link", { name: "Import CSV" })).toHaveCount(0);

  await viewer.getByRole("link", { name: "ZZ Test College" }).click();
  await expect(viewer.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Archive" })).toHaveCount(0);
});

test("CSV dry run shows row errors and writes nothing; a clean file imports", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  const before = count();
  await page.goto("/institutions/import");

  const bad = "name,kind,city\nZZ Test College,engineering_college,Nashik\nZZ Fresh Polytechnic,polytechnic,Nagpur\nZZ Broken,not-a-kind,Pune\n";
  await page.getByLabel("CSV file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
  await expect(page.getByRole("table", { name: "Rows with problems" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+/ })).toHaveCount(0);
  expect(count()).toBe(before);

  await page.getByRole("button", { name: "Start over" }).click();
  const good = "name,kind,city\nZZ Import One,school,Pune\nZZ Import Two,polytechnic,Nagpur\n";
  await page.getByLabel("CSV file").setInputFiles({ name: "good.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
  await page.getByRole("button", { name: "Import 2 institutions" }).click();
  await expect(page.locator("#main").getByText("Imported 2 institutions")).toBeVisible();
  expect(count()).toBe(before + 2);
});
