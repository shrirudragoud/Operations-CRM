import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Files on tasks (0039), on the LOCAL stack only (needs the storage service). All names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "tf-founder@hardcode.local";
const WORKER = "tf-worker@hardcode.local";
const VIEWER = "tf-viewer@hardcode.local";
const TITLE = "ZZ Files task";

const PNG = {
  name: "diagram.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
};
const PDF = { name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") };
const NOTE = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("remember the glue") };
const SVG = { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") };
const EXE = { name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ not allowed") };

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

async function open(page: Page) {
  await page.goto(`/tasks/${taskId()}`);
  await page.waitForLoadState("networkidle");
}

const taskId = () => sql(`select id from ops.task where title = '${TITLE}'`);
const filesOf = (page: Page) => page.getByRole("region", { name: "Task files" });
const fileRow = (page: Page, name: string) => filesOf(page).getByRole("list", { name: "Files", exact: true }).getByRole("listitem").filter({ hasText: name });

test.beforeAll(async ({ browser }) => {
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values
    ('${WORKER}', 'ZZ Worker', 'member', '{workshop}'),
    ('${VIEWER}', 'ZZ Viewer', 'viewer', '{workshop}')`);
  for (const email of [FOUNDER, WORKER, VIEWER]) createPasswordUser(email, PASSWORD);
  for (const email of [WORKER, VIEWER, FOUNDER]) await (await signedIn(browser, email)).context().close();
  sql(`
    set session_replication_role = replica;
    insert into ops.task (title, department, assignee_id, created_by)
      select '${TITLE}', 'workshop', w.id, f.id from ops.staff w, ops.staff f where w.email = '${WORKER}' and f.email = '${FOUNDER}';
    set session_replication_role = origin;
  `);
});

test("the person doing the task uploads an image and a PDF", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  await expect(filesOf(page).getByText("No files yet.")).toBeVisible();
  await filesOf(page).locator('input[type="file"]').setInputFiles([PNG, PDF]);
  await expect(fileRow(page, "diagram.png")).toBeVisible();
  await expect(fileRow(page, "plan.pdf")).toBeVisible();
  await expect(fileRow(page, "plan.pdf")).toContainText("PDF");
  expect(sql(`select count(*) from ops.task_attachment where task_id = '${taskId()}' and deleted_at is null`)).toBe("2");
  expect(sql(`select string_agg(kind, ',' order by name) from ops.task_attachment where task_id = '${taskId()}'`)).toBe("image,document");
  expect(sql(`select attachment_count from ops.task where id = '${taskId()}'`)).toBe("2");
  await expect(page.getByText("Files (2)", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Grid" }).click();
  await expect(fileRow(page, "diagram.png")).toBeVisible();
});

test("a type that is not allowed is refused and nothing is stored", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  const input = filesOf(page).locator('input[type="file"]');
  await input.setInputFiles(SVG);
  await expect(filesOf(page).getByRole("alert").filter({ hasText: "logo.svg" })).toContainText("That file type is not allowed");
  await input.setInputFiles(EXE);
  await expect(filesOf(page).getByRole("alert").filter({ hasText: "setup.exe" })).toContainText("That file type is not allowed");
  expect(sql(`select count(*) from ops.task_attachment where task_id = '${taskId()}'`)).toBe("2");
});

test("a file that is not what it says is refused", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  await filesOf(page).locator('input[type="file"]').setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is an executable") });
  await expect(filesOf(page).getByRole("alert").filter({ hasText: "fake.pdf" })).toContainText("doesn't look like a real PDF");
  expect(sql(`select count(*) from ops.task_attachment where task_id = '${taskId()}'`)).toBe("2");
});

test("removing a file can be undone", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  await fileRow(page, "plan.pdf").getByRole("button", { name: "Remove plan.pdf" }).click();
  await expect(fileRow(page, "plan.pdf")).toHaveCount(0);
  expect(sql(`select count(*) from ops.task_attachment where name = 'plan.pdf' and deleted_at is not null`)).toBe("1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fileRow(page, "plan.pdf")).toBeVisible();
  expect(sql(`select count(*) from ops.task_attachment where name = 'plan.pdf' and deleted_at is null`)).toBe("1");
});

test("a comment can carry a file", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  await page.getByLabel("Add a comment").fill("Notes attached");
  await page.getByRole("button", { name: "Attach files" }).locator("xpath=ancestor::form").locator('input[type="file"]').setInputFiles(NOTE);
  await expect(page.getByRole("list", { name: "Files to attach" }).getByText("notes.txt")).toBeVisible();
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = page.getByRole("list", { name: "Comments" }).getByRole("listitem").filter({ hasText: "Notes attached" });
  await expect(comment.getByText("notes.txt")).toBeVisible();
  expect(sql(`select count(*) from ops.task_attachment a join ops.task_comment c on c.id = a.comment_id where a.name = 'notes.txt'`)).toBe("1");
  await expect(filesOf(page).getByRole("list", { name: "Files", exact: true }).getByText("notes.txt")).toHaveCount(0);
});

test("a read-only viewer sees the files but cannot add or remove", async ({ browser }) => {
  const page = await signedIn(browser, VIEWER);
  await open(page);
  await expect(fileRow(page, "diagram.png")).toBeVisible();
  await expect(fileRow(page, "plan.pdf")).toBeVisible();
  await expect(filesOf(page).getByRole("button", { name: "Browse files" })).toHaveCount(0);
  await expect(filesOf(page).locator('input[type="file"]')).toHaveCount(0);
  await expect(filesOf(page).getByRole("button", { name: /^Remove / })).toHaveCount(0);
});

async function paste(page: Page, selector: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.evaluate(
    ({ selector, name, type, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type }));
      document.querySelector(selector)!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { selector, name: file.name, type: file.mimeType, b64: file.buffer.toString("base64") },
  );
}

test("a file pasted anywhere on the page is added to the task's files", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  await paste(page, "main", { name: "pasted-note.txt", mimeType: "text/plain", buffer: Buffer.from("pasted from the clipboard") });
  await expect(fileRow(page, "pasted-note.txt")).toBeVisible();
  expect(sql(`select count(*) from ops.task_attachment where task_id = '${taskId()}' and name = 'pasted-note.txt' and comment_id is null`)).toBe("1");
});

test("a file pasted into the comment box goes on the comment, not on the task", async ({ browser }) => {
  const page = await signedIn(browser, WORKER);
  await open(page);
  const box = page.getByLabel("Add a comment");
  await box.fill("see the attached note");
  await paste(page, "#task-comment", { name: "comment-note.txt", mimeType: "text/plain", buffer: Buffer.from("for the comment") });
  await expect(page.getByRole("list", { name: "Files to attach" })).toContainText("comment-note.txt");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("list", { name: "Comments" })).toContainText("see the attached note");
  await expect(page.getByRole("list", { name: /Files on the comment by/ }).filter({ hasText: "comment-note.txt" })).toHaveCount(1);
  expect(sql(`select count(*) from ops.task_attachment where task_id = '${taskId()}' and name = 'comment-note.txt' and comment_id is not null`)).toBe("1");
  await expect(fileRow(page, "comment-note.txt")).toHaveCount(0);
});
