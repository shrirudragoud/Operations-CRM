import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Files on HR requests (0036): the person attaches, HR opens (logged), HR answers with a letter and keeps a copy,
// the person is told and finds it under Documents; nobody else can see it. LOCAL stack only.
const PASSWORD = "correct-horse-battery";
const FOUNDER = "rf-founder@hardcode.local";
const HRPERSON = "rf-hr@hardcode.local";
const MEMBER = "rf-member@hardcode.local";
const OTHER = "rf-other@hardcode.local";

const PDF = (title: string) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${title}\ntrailer<<>>\n%%EOF`);
const PROOF = { name: "visa-form.pdf", mimeType: "application/pdf", buffer: PDF("proof") };
const LETTER = { name: "experience-letter.pdf", mimeType: "application/pdf", buffer: PDF("letter") };
const FAKE = { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is an executable pretending") };

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (u?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(u));
      return null;
    };
  });
  return page;
}

const staffId = (email: string) => sql(`select id from ops.staff where email = '${email}'`);
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${HRPERSON}', 'ZZ Hira', 'member', '{sales}'),
    ('${MEMBER}', 'ZZ Member', 'member', '{workshop}'),
    ('${OTHER}', 'ZZ Other', 'member', '{sales}')`);
  for (const email of [FOUNDER, HRPERSON, MEMBER, OTHER]) createPasswordUser(email, PASSWORD);
  for (const email of [HRPERSON, MEMBER, OTHER]) await (await signedIn(browser, email)).context().close();
  sql(`update ops.staff set is_hr = true where email = '${HRPERSON}'`);
});

test("a file that is not what it says is refused, and nothing is created", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me/requests");
  await page.getByLabel("Subject").fill("Bad file");
  await page.getByLabel("Attach files (optional)").setInputFiles(FAKE);
  await page.getByRole("button", { name: "Send to HR" }).click();
  await expect(page.getByText("doesn't look like a real PDF")).toBeVisible();
  expect(sql(`select count(*) from ops.hr_request where subject = 'Bad file'`)).toBe("0");

  await page.getByRole("button", { name: "Remove fake.pdf" }).click();
  await page.getByLabel("Attach files (optional)").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("Upload a PDF or an image")).toBeVisible();
});

test("a member attaches a PDF to a new request", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me/requests");
  await page.getByLabel("Subject").fill("Visa letter");
  await page.getByLabel("Attach files (optional)").setInputFiles(PROOF);
  await expect(page.getByRole("list", { name: "Files to send" }).getByText("visa-form.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Send to HR" }).click();
  await expect(page.getByRole("heading", { name: "Visa letter" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Files you sent with Visa letter" }).getByText("visa-form.pdf")).toBeVisible();

  expect(sql(`select count(*) from ops.hr_request_file where staff_id = '${staffId(MEMBER)}' and message_id is null`)).toBe("1");
  const path = sql(`select path from ops.hr_request_file`);
  expect(path.startsWith(`${staffId(MEMBER)}/`)).toBe(true);
  expect(sql(`select count(*) from storage.objects where bucket_id = 'hr-docs' and name = '${path}'`)).toBe("1");
  expect(sql(`select count(*) from ops.notification where kind = 'request_new' and recipient_id = '${staffId(HRPERSON)}'`)).toBe("1");
});

test("another employee cannot see the file, and the database agrees", async ({ browser }) => {
  const page = await signedIn(browser, OTHER);
  await page.goto("/me/requests");
  await expect(page.getByText("visa-form.pdf")).toHaveCount(0);
  const as = (q: string) => sql(`
    set role authenticated; select set_config('request.jwt.claims', '{"sub":"${staffId(OTHER)}","role":"authenticated"}', false);
    ${q}`).split("\n").pop();
  expect(as(`select count(*) from ops.hr_request_file`)).toBe("0");
  expect(as(`select count(*) from storage.objects where bucket_id = 'hr-docs'`)).toBe("0");
});

test("HR opens the member's file and the open is logged", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/requests");
  const card = hr.getByRole("region", { name: /Visa letter/ });
  await card.getByRole("button", { name: "Open visa-form.pdf" }).click();
  await expect.poll(async () => (await opened(hr)).length).toBe(1);
  const [url] = await opened(hr);
  expect(url).toContain("/storage/v1/object/sign/hr-docs/");
  const res = await hr.request.get(url!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
  expect(sql(`select count(*) from ops.hr_access_log where actor_id = '${staffId(HRPERSON)}' and what like 'opened document %visa-form.pdf'`)).toBe("1");
});

test("HR answers with a letter and keeps a copy; the member is told", async ({ browser }) => {
  const hr = await signedIn(browser, HRPERSON);
  await hr.goto("/hr/requests");
  const card = hr.getByRole("region", { name: /Visa letter/ });
  await card.getByLabel("Write a message").fill("Your letter is attached.");
  await card.getByLabel("Attach files for the person").setInputFiles(LETTER);
  await expect(card.getByLabel("Also keep a copy in their documents")).toBeChecked();
  await card.getByRole("button", { name: "Answer Visa letter with this reply" }).click();

  await expect.poll(() => sql(`select state from ops.hr_request where subject = 'Visa letter'`)).toBe("done");
  expect(sql(`select count(*) from ops.hr_request_file where name = 'experience-letter.pdf' and message_id is not null`)).toBe("1");
  expect(sql(`select kind || ':' || (verified_at is not null) from ops.staff_document where staff_id = '${staffId(MEMBER)}'`)).toBe("letter:true");
  expect(sql(`select count(*) from ops.notification where kind = 'request_hr_reply' and recipient_id = '${staffId(MEMBER)}'`)).toBe("1");
});

test("the member sees the notice, opens the letter, and finds it under Documents", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me/requests");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByText("HR answered: Visa letter")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open experience-letter.pdf" }).click();
  await expect.poll(async () => (await opened(page)).length).toBe(1);
  const [url] = await opened(page);
  const res = await page.request.get(url!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");

  await page.goto("/me/documents");
  await expect(page.getByText("Visa letter")).toBeVisible();
  await expect(page.getByText("Letter from HR")).toBeVisible();
});

test("a person's reply with a file tells HR, and a closed request takes no more", async ({ browser }) => {
  sql(`insert into ops.hr_request (staff_id, kind, subject) values ('${staffId(MEMBER)}', 'other', 'Second ask')`);
  const page = await signedIn(browser, MEMBER);
  await page.goto("/me/requests");
  const card = page.getByRole("region", { name: "Second ask" });
  await card.getByLabel("Attach files for HR").setInputFiles(PROOF);
  await card.getByRole("button", { name: "Send message on Second ask" }).click();
  await expect.poll(() => sql(`select count(*) from ops.notification where kind = 'request_person_reply' and recipient_id = '${staffId(HRPERSON)}'`)).toBe("1");
  await expect(card.getByRole("list", { name: /^Files from/ }).getByText("visa-form.pdf")).toBeVisible();

  const visa = page.getByRole("region", { name: "Visa letter" });
  await expect(visa.getByLabel("Write a message")).toHaveCount(0);
});
