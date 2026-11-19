import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Employee portal P4 (0033): papers, the policy library and acknowledgements. LOCAL stack only (needs Supabase Storage).
const PASSWORD = "correct-horse-battery";
const FOUNDER = "pd-founder@hardcode.local";
const HRPERSON = "pd-hr@hardcode.local";
const MEMBER = "pd-member@hardcode.local";
const OTHER = "pd-other@hardcode.local";
const VIEWER = "pd-viewer@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const staffId = (email: string) => sql(`select id from ops.staff where email = '${email}'`);

const PDF = { name: "address-proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") };
const NOT_A_PDF = { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is an executable pretending") };

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${HRPERSON}', 'ZZ Hira', 'member', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}'),
    ('${OTHER}', 'ZZ Other', 'member', '{sales}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, OTHER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, OTHER, VIEWER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
});

test("a member uploads a paper, sees it waiting, and a fake file is refused", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me");
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/me\/documents$/);

  await page.getByLabel("Title").fill("Rental agreement");
  await page.getByLabel("File").setInputFiles(NOT_A_PDF);
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("doesn't look like a real PDF")).toBeVisible();

  await page.getByLabel("File").setInputFiles(PDF);
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Rental agreement")).toBeVisible();
  await expect.poll(() => sql(`select count(*) from ops.staff_document where staff_id = '${staffId(MEMBER)}'`)).toBe("1");
  await expect(page.getByText("Waiting for HR")).toBeVisible();
});

test("another employee cannot see it, and the database agrees", async ({ browser }) => {
  const page = await signedIn(browser, OTHER);
  await page.goto("/me/documents");
  await expect(page.getByText("Rental agreement")).toHaveCount(0);
  expect(sql(`
    set role authenticated; select set_config('request.jwt.claims', '{"sub":"${staffId(OTHER)}","role":"authenticated"}', false);
    select count(*) from ops.staff_document where staff_id = '${staffId(MEMBER)}'`).split("\n").pop()).toBe("0");
});

test("HR opens it (and it is logged), then declines it with a reason", async ({ browser }) => {
  const page = await signedIn(browser, HRPERSON);
  await page.goto("/hr/documents");
  await expect(page.getByText("Rental agreement")).toBeVisible();
  await page.getByRole("button", { name: "Decline Rental agreement" }).click();
  await page.getByLabel("Why").fill("The second page is cut off");
  await page.getByRole("button", { name: "Send back" }).click();
  await expect.poll(() => sql(`select verify_note from ops.staff_document where staff_id = '${staffId(MEMBER)}'`)).toBe("The second page is cut off");

  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/documents");
  await expect(member.getByText("The second page is cut off")).toBeVisible();
});

test("HR publishes a policy, a member reads it and acknowledges it once", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/documents");
  const publish = hr.locator("form").filter({ has: hr.getByRole("button", { name: "Publish document" }) });
  await publish.getByLabel("Title").fill("Leave policy");
  await publish.getByLabel("File").setInputFiles(PDF);
  await hr.getByRole("button", { name: "Publish document" }).click();
  await expect.poll(() => sql(`select count(*) from ops.company_document where title = 'Leave policy'`)).toBe("1");

  const member = await signedIn(browser, MEMBER);
  await member.goto("/me/documents");
  await member.getByRole("button", { name: "I have read Leave policy" }).click();
  await expect.poll(() => sql(`select count(*) from ops.policy_ack where staff_id = '${staffId(MEMBER)}'`)).toBe("1");
  await expect(member.getByRole("button", { name: "I have read Leave policy" })).toHaveCount(0);
});

test("a viewer has no Documents tab and no access to the HR page", async ({ browser }) => {
  const page = await signedIn(browser, VIEWER);
  await page.goto("/me");
  await expect(page.getByRole("tab", { name: "Documents" })).toHaveCount(0);
  await page.goto("/hr/documents");
  await expect(page.getByText("You don't have access", { exact: false })).toBeVisible();
});
