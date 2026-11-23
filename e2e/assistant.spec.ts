import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";
import { startGeminiStub, STUB_KEY } from "./gemini-stub";

// The assistant on the LOCAL stack, with a stub Gemini server. No real key, no network. Names start with "ZZ".
const PASSWORD = "correct-horse-battery";
const FOUNDER = "ai-founder@hardcode.local";
const MEMBER = "ai-member@hardcode.local";

test.describe.configure({ mode: "serial" });

const stub = startGeminiStub();
const count = (q: string) => Number(sql(q));

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInWithPassword(page, email, PASSWORD);
  return page;
}

async function ask(page: Page, text: string) {
  await page.getByLabel("Message the assistant").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.beforeAll(async () => {
  await stub.listen();
  resetDatabase(FOUNDER);
  sql(`insert into ops.invite (email, full_name, role, departments) values ('${MEMBER}', 'ZZ Member', 'member', '{sales}')`);
  for (const email of [FOUNDER, MEMBER]) createPasswordUser(email, PASSWORD);
});

test.afterAll(async () => {
  await stub.close();
});

test("a wrong key is refused and nothing is stored; a good key is stored encrypted", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Connect your Gemini key" })).toBeVisible();

  await page.getByLabel("Your Gemini API key").fill("AIzaSyWRONGWRONGWRONGWRONGWRONGWRONG123");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(/did not accept|not valid|key/i).first()).toBeVisible();
  expect(count("select count(*) from ops.ai_key")).toBe(0);

  await page.getByLabel("Your Gemini API key").fill(STUB_KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByLabel("Message the assistant")).toBeVisible();
  expect(count("select count(*) from ops.ai_key")).toBe(1);
  expect(sql("select cipher from ops.ai_key")).toMatch(/^v1\./);
  expect(sql(`select position('${STUB_KEY}' in cipher) from ops.ai_key`)).toBe("0");
  expect(sql("select model from ops.ai_key")).toBe("gemini-2.5-flash");

  const listed = stub.log.filter((r) => r.url.startsWith("/v1beta/models?"));
  expect(listed.length).toBeGreaterThan(0);
  expect(stub.log.every((r) => !r.url.includes(STUB_KEY))).toBe(true);
});

test("it looks things up and answers, and the chat is saved", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  await ask(page, "Who is late?");
  await expect(page.getByText("Nothing is late right now.")).toBeVisible();
  await expect(page).toHaveURL(/\/assistant\?c=[0-9a-f-]{36}$/);
  expect(count("select count(*) from ops.ai_conversation")).toBe(1);
  expect(count("select count(*) from ops.ai_message where role = 'user'")).toBe(1);
  expect(count("select count(*) from ops.ai_message where role = 'tool'")).toBe(1);

  await page.reload();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("Who is late?")).toBeVisible();
  await expect(log.getByText("Nothing is late right now.")).toBeVisible();
  await expect(page.getByText("search_tasks")).toHaveCount(0);

  const sent = stub.log.filter((r) => r.contents).at(-1)!;
  expect(sent.key).toBe(STUB_KEY);
  expect(sent.system).toContain("Local Founder");
});

test("a task is only created after Confirm, and a discarded draft creates nothing", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  await ask(page, "Create task: ZZ Bot task");
  const card = page.getByTestId("draft-card");
  await expect(card).toContainText("ZZ Bot task");
  await expect(card).toContainText("Local Founder");
  await expect(card).toContainText("Priority");
  await expect(card).toContainText("Normal");
  await expect(card).toContainText("15 Jan");
  await expect(page.getByText("The draft is ready for you to confirm.")).toBeVisible();
  expect(count("select count(*) from ops.task where title = 'ZZ Bot task'")).toBe(0);
  expect(count("select count(*) from ops.ai_action where status = 'pending'")).toBe(1);

  await card.getByRole("button", { name: "Create task" }).click();
  await expect(card).toHaveAttribute("data-status", "done");
  await expect(card.getByRole("link", { name: "Open the task" })).toBeVisible();
  expect(sql("select s.full_name from ops.task t join ops.staff s on s.id = t.assignee_id where t.title = 'ZZ Bot task'")).toBe("Local Founder");
  expect(count("select count(*) from ops.task where title = 'ZZ Bot task'")).toBe(1);

  await ask(page, "Create task: ZZ Discarded task");
  const second = page.getByTestId("draft-card").nth(1);
  await expect(second).toContainText("ZZ Discarded task");
  await second.getByRole("button", { name: "Discard" }).click();
  await expect(second).toHaveAttribute("data-status", "cancelled");
  expect(count("select count(*) from ops.task where title = 'ZZ Discarded task'")).toBe(0);
});

test("replying \"create\" to a task card creates it without another Gemini call", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  await ask(page, "Create task: ZZ Reply task");
  const card = page.getByTestId("draft-card");
  await expect(card).toContainText("ZZ Reply task");
  expect(count("select count(*) from ops.task where title = 'ZZ Reply task'")).toBe(0);
  const calls = stub.log.length;

  await ask(page, "create");
  await expect(card).toHaveAttribute("data-status", "done");
  expect(count("select count(*) from ops.task where title = 'ZZ Reply task'")).toBe(1);
  expect(stub.log.length).toBe(calls);
  await expect(page.getByRole("log", { name: "Conversation" }).getByRole("link", { name: "ZZ Reply task" })).toBeVisible();

  await ask(page, "create");
  expect(count("select count(*) from ops.task where title = 'ZZ Reply task'")).toBe(1);
});

test("it reads the calendar and the deals across areas, and its prompt lists only the areas it may use", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  await ask(page, "What is on 2099-03-03?");
  await expect(page.getByText("Looked at the calendar: 0 items.")).toBeVisible();
  await ask(page, "Show me the open deals");
  await expect(page.getByText("Checked the pipeline.")).toBeVisible();
  const sent = stub.log.filter((r) => r.contents).at(-1)!;
  expect(sent.system).toContain("Calendar");
  expect(sent.system).toContain("Sales");
});

test("the quick panel knows the open task", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  const id = sql("select id from ops.task where title = 'ZZ Bot task'");
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Open the assistant" }).click();
  await ask(page, "Explain this task");
  await expect(page.getByText("I can see the open task.")).toBeVisible();

  await page.goto("/tasks");
  await page.getByRole("button", { name: "Open the assistant" }).click();
  await ask(page, "Explain this task");
  await expect(page.getByText("No task is open.")).toBeVisible();
});

test("when Gemini is out of quota the question is not kept and the person is told", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  const before = count("select count(*) from ops.ai_message where role = 'user'");
  stub.mode.fail = true;
  try {
    await ask(page, "Who is late?");
    await expect(page.getByText(/quota|limit/i).first()).toBeVisible();
  } finally {
    stub.mode.fail = false;
  }
  expect(count("select count(*) from ops.ai_message where role = 'user'")).toBe(before);
});

test("another person cannot see the chats, the key or the drafts", async ({ browser }) => {
  const page = await signedIn(browser, MEMBER);
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Connect your Gemini key" })).toBeVisible();
  await expect(page.getByText("Who is late?")).toHaveCount(0);

  const chat = sql("select id from ops.ai_conversation limit 1");
  await page.goto(`/assistant?c=${chat}`);
  await expect(page.getByText("Who is late?")).toHaveCount(0);

  expect(count("select count(*) from ops.ai_key")).toBe(1);
});

test("on a phone the chat fits the screen and the chat list opens in a drawer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signInWithPassword(page, FOUNDER, PASSWORD);
  await page.goto("/assistant");

  const box = page.getByLabel("Message the assistant");
  const send = page.getByRole("button", { name: "Send" });
  await expect(box).toBeVisible();
  for (const el of [box, send]) {
    const b = await el.boundingBox();
    expect(b).not.toBeNull();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(375);
    expect(b!.y + b!.height).toBeLessThanOrEqual(667);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(page.getByRole("navigation", { name: "Chats" })).toHaveCount(0);

  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible();
  await page.getByRole("navigation", { name: "Chats" }).getByRole("link").first().click();
  await expect(page.getByRole("navigation", { name: "Chats" })).toHaveCount(0);
  await context.close();
});

test("removing the key takes the chat box away", async ({ browser }) => {
  const page = await signedIn(browser, FOUNDER);
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Gemini key and model" }).click();
  await page.getByRole("button", { name: "Remove key" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.getByRole("heading", { name: "Connect your Gemini key" })).toBeVisible();
  expect(count("select count(*) from ops.ai_key")).toBe(0);
});
