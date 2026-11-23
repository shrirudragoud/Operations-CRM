import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// People & HR home (0037): the action list, the overview and sending a file. LOCAL stack only (needs Supabase Storage).
const PASSWORD = "correct-horse-battery";
const FOUNDER = "hh-founder@hardcode.local";
const HRPERSON = "hh-hr@hardcode.local";
const MEMBER = "hh-member@hardcode.local";
const OTHER = "hh-other@hardcode.local";

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

const staffId = (email: string) => sql(`select id from ops.staff where email = '${email}'`);

const PDF = { name: "experience-letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") };
const NOT_A_PDF = { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is an executable pretending") };
const TEXT = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just some words") };

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${HRPERSON}', 'ZZ Hira', 'member', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}'),
    ('${OTHER}', 'ZZ Other', 'member', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, OTHER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, OTHER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
  const m = staffId(MEMBER);
  sql(`
    insert into ops.leave_request (staff_id, leave_type_id, from_date, to_date, days, reason)
      values ('${m}', (select id from ops.leave_type where code = 'casual'), ops.today_ist() + 1, ops.today_ist() + 2, 2, 'Family function');
    insert into ops.hr_request (staff_id, kind, subject) values ('${m}', 'experience_letter', 'Experience letter');
    insert into ops.staff_document (staff_id, kind, title, path, mime, size_bytes, uploaded_by)
      values ('${m}', 'id_proof', 'Aadhaar', '${m}/' || gen_random_uuid() || '-aadhaar.pdf', 'application/pdf', 2048, '${m}');`);
});

test("HR sees what is waiting, with counts and links to where it is handled", async ({ browser }) => {
  const page = await signedIn(browser, HRPERSON);
  await page.goto("/hr");
  await expect(page.getByRole("heading", { name: "Needs action today" })).toBeVisible();

  await expect(page.getByRole("link", { name: "1 leave to approve" })).toHaveAttribute("href", "/hr/leave");
  await expect(page.getByRole("link", { name: "1 requests waiting" })).toHaveAttribute("href", "/hr/requests");
  await expect(page.getByRole("link", { name: "1 papers to verify" })).toHaveAttribute("href", "/hr/documents");

  const list = page.getByRole("list", { name: "Needs action", exact: true });
  await expect(list.getByRole("link", { name: "Review: Casual leave for ZZ Member" })).toHaveAttribute("href", "/hr/leave");
  await expect(list.getByRole("link", { name: "Answer: Experience letter for ZZ Member" })).toHaveAttribute("href", "/hr/requests");
  await expect(list.getByRole("link", { name: "Verify: Aadhaar for ZZ Member" })).toHaveAttribute("href", "/hr/documents");
  await expect(list.getByRole("link", { name: "ZZ Member" }).first()).toHaveAttribute("href", `/hr/people/${staffId(MEMBER)}`);
  await expect(list).toContainText("Waiting since today");

  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On leave today" })).toContainText("Everyone is in.");
  await expect(page.getByRole("navigation", { name: "People & HR sections" }).getByRole("link", { name: "Documents" })).toBeVisible();
});

test("a plain member cannot open the HR home", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/hr");
  await expect(page.getByText("You don't have access", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs action today" })).toHaveCount(0);
});

test("a file that is not a real PDF, or not a PDF or image at all, is refused", async ({ browser }) => {
  const page = await signedIn(browser, HRPERSON);
  await page.goto("/hr");
  const form = page.getByRole("form", { name: "Send a file to a person" });
  await form.getByRole("combobox", { name: "Send to" }).click();
  await page.getByRole("option", { name: "ZZ Member" }).click();
  await form.getByLabel("Title").fill("Experience letter");

  await form.getByLabel("File", { exact: true }).setInputFiles(NOT_A_PDF);
  await form.getByRole("button", { name: "Send file" }).click();
  await expect(form.getByRole("alert")).toContainText("doesn't look like a real PDF");

  await form.getByLabel("File", { exact: true }).setInputFiles(TEXT);
  await form.getByRole("button", { name: "Send file" }).click();
  await expect(form.getByRole("alert")).toContainText("Upload a PDF or an image");
  expect(sql(`select count(*) from ops.staff_document where title = 'Experience letter'`)).toBe("0");
});

test("HR sends a file; the person finds it verified under Documents and in their notifications", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr");
  const form = hr.getByRole("form", { name: "Send a file to a person" });

  await form.getByRole("button", { name: "Send file" }).click();
  await expect(form.getByRole("alert")).toContainText("Choose who this is for");

  await form.getByRole("combobox", { name: "Send to" }).click();
  await hr.getByRole("option", { name: "ZZ Member" }).click();
  await form.getByLabel("Title").fill("Experience letter");
  await form.getByLabel("Note (optional)").fill("Signed copy");
  await form.getByLabel("File", { exact: true }).setInputFiles(PDF);
  await form.getByRole("button", { name: "Send file" }).click();

  await expect.poll(() => sql(`select count(*) from ops.staff_document where title = 'Experience letter' and verified_at is not null and uploaded_by = '${staffId(HRPERSON)}'`)).toBe("1");
  await expect.poll(() => sql(`select count(*) from ops.notification where kind = 'hr_file' and recipient_id = '${staffId(MEMBER)}'`)).toBe("1");
  await expect(hr.getByText("Sent to ZZ Member")).toBeVisible();
  await hr.reload();
  await expect(hr.getByRole("table")).toContainText("sent document Experience letter");

  const member = await signedIn(browser, MEMBER);
  await member.getByRole("button", { name: /^Notifications/ }).click();
  await member.getByRole("link", { name: /HR sent you a file: Experience letter - Signed copy/ }).click();
  await expect(member).toHaveURL(/\/me\/documents$/);
  await expect(member.getByText("Experience letter")).toBeVisible();
  await expect(member.getByText("Waiting for HR")).toHaveCount(1);

  const other = await signedIn(browser, OTHER);
  await other.goto("/me/documents");
  await expect(other.getByText("Experience letter")).toHaveCount(0);
});
