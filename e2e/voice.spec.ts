import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";
import { startGeminiStub, STUB_KEY } from "./gemini-stub";

// Voice mode on the LOCAL stack. The Live socket is replaced in the browser (page.routeWebSocket) by a script that plays
// the part of Gemini; Chromium supplies a fake microphone. This proves the wiring (token, setup, tools, confirm gate,
// saving), not the sound of a real voice.
const PASSWORD = "correct-horse-battery";
const FOUNDER = "voice-founder@hardcode.local";

test.describe.configure({ mode: "serial" });
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const stub = startGeminiStub();
const count = (q: string) => Number(sql(q));
const audio = Buffer.from(new Int16Array(2400).fill(500).buffer).toString("base64");

test.beforeAll(async () => {
  await stub.listen();
  resetDatabase(FOUNDER);
  createPasswordUser(FOUNDER, PASSWORD);
});
test.afterAll(async () => {
  await stub.close();
});

async function ready(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await signInWithPassword(page, FOUNDER, PASSWORD);
  if (count("select count(*) from ops.ai_key") === 0) {
    await page.goto("/assistant");
    await page.getByLabel("Your Gemini API key").fill(STUB_KEY);
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByLabel("Message the assistant")).toBeVisible();
  }
  return page;
}

let frames = 0;

type Step = { match: (m: Record<string, unknown>) => boolean; reply: Record<string, unknown>[] };

/** A scripted Gemini: starts with `opening` once the setup is accepted, then answers each client message that matches a step. */
async function script(page: Page, opening: Record<string, unknown>[], steps: Step[]) {
  const seen: Record<string, unknown>[] = [];
  frames = 0;
  await page.routeWebSocket(/BidiGenerateContentConstrained/, (ws) => {
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>;
      if ("realtimeInput" in m) {
        frames++;
        return;
      }
      seen.push(m);
      if ("setup" in m) {
        ws.send(JSON.stringify({ setupComplete: {} }));
        setTimeout(() => opening.forEach((o) => ws.send(JSON.stringify(o))), 300);
        return;
      }
      for (const step of steps) if (step.match(m)) step.reply.forEach((r) => ws.send(JSON.stringify(r)));
    });
  });
  return seen;
}

const answeredTool = (name: string) => (m: Record<string, unknown>) => {
  const r = (m.toolResponse as { functionResponses?: { name: string }[] } | undefined)?.functionResponses;
  return !!r?.some((f) => f.name === name);
};
const said = (text: string) => ({ serverContent: { modelTurn: { parts: [{ inlineData: { data: audio, mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text } } });
const done = { serverContent: { turnComplete: true } };
const heard = (text: string) => ({ serverContent: { inputTranscription: { text } } });
const callTool = (id: string, name: string, args: Record<string, unknown> = {}) => ({ toolCall: { functionCalls: [{ id, name, args }] } });

test("the mic button starts a call, the day is read through a tool, and the talk is saved as a chat", async ({ browser }) => {
  const page = await ready(browser);
  const seen = await script(page, [heard("What is my day?"), callTool("c1", "my_day")], [{ match: answeredTool("my_day"), reply: [said("You have nothing due today."), done] }]);
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Talk", exact: true }).click();

  await expect(page.getByText("You have nothing due today.")).toBeVisible();
  await expect(page.getByRole("button", { name: "End voice call" })).toBeVisible();

  const setup = (seen.find((m) => "setup" in m) as { setup: { model: string; tools: { functionDeclarations: { name: string }[] }[]; systemInstruction: { parts: { text: string }[] } } }).setup;
  expect(setup.model).toBe("models/gemini-3.8-live");
  const tools = setup.tools[0]!.functionDeclarations.map((t) => t.name);
  expect(tools).toContain("my_day");
  expect(tools).toContain("confirm_drafts");
  expect(setup.systemInstruction.parts[0]!.text).toContain("Local Founder");
  expect(JSON.stringify(seen)).not.toContain(STUB_KEY);
  expect(stub.log.some((r) => r.url === "/v1beta/auth_tokens")).toBe(true);

  await page.getByRole("button", { name: "End voice call" }).click();
  await expect(page.getByRole("button", { name: "Talk", exact: true })).toBeVisible();
  await expect.poll(() => count("select count(*) from ops.ai_message where role = 'user'")).toBe(1);
  expect(sql("select content->'parts'->0->>'text' from ops.ai_message where role = 'user'")).toBe("What is my day?");
  expect(sql("select content->'parts'->0->>'text' from ops.ai_message where role = 'model'")).toBe("You have nothing due today.");
  await expect(page).toHaveURL(/\/assistant\?c=[0-9a-f-]{36}$/);
});

test("a spoken task is drafted, nothing is created until the person says create", async ({ browser }) => {
  const page = await ready(browser);
  await script(
    page,
    [heard("Add a task ZZ Voice task for tomorrow"), callTool("d1", "propose_create_task", { title: "ZZ Voice task", due_date: "2099-01-15", priority: 3 })],
    [
      { match: answeredTool("propose_create_task"), reply: [said("Your task card is ready. Say create."), done] },
      { match: answeredTool("confirm_drafts"), reply: [said("Done, it is created."), done] },
    ],
  );
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Talk", exact: true }).click();

  const card = page.getByTestId("draft-card");
  await expect(card).toContainText("ZZ Voice task");
  await expect(page.getByText("Your task card is ready. Say create.")).toBeVisible();
  expect(count("select count(*) from ops.task where title = 'ZZ Voice task'")).toBe(0);
  expect(count("select count(*) from ops.ai_action where status = 'pending'")).toBe(1);
  await page.getByRole("button", { name: "End voice call" }).click();
  await expect.poll(() => count("select count(*) from ops.ai_message")).toBeGreaterThan(0);
  await expect(card).toHaveAttribute("data-status", "pending");
  expect(count("select count(*) from ops.task where title = 'ZZ Voice task'")).toBe(0);

  await page.getByRole("button", { name: "Create task" }).click();
  await expect(card).toHaveAttribute("data-status", "done");
  expect(count("select count(*) from ops.task where title = 'ZZ Voice task'")).toBe(1);
});

test("the model cannot confirm on its own: confirm_drafts without a spoken yes does nothing", async ({ browser }) => {
  const page = await ready(browser);
  await script(
    page,
    [heard("Add a task ZZ Sneaky task"), callTool("e1", "propose_create_task", { title: "ZZ Sneaky task", due_date: "2099-01-16", priority: 3 })],
    [{ match: answeredTool("propose_create_task"), reply: [callTool("e2", "confirm_drafts")] }, { match: answeredTool("confirm_drafts"), reply: [said("I could not confirm."), done] }],
  );
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  await expect(page.getByText("I could not confirm.")).toBeVisible();
  await expect(page.getByTestId("draft-card")).toHaveAttribute("data-status", "pending");
  expect(count("select count(*) from ops.task where title = 'ZZ Sneaky task'")).toBe(0);
  await page.getByRole("button", { name: "End voice call" }).click();
});

test("a spoken yes after the card confirms it", async ({ browser }) => {
  const page = await ready(browser);
  await script(
    page,
    [heard("Add a task ZZ Yes task"), callTool("f1", "propose_create_task", { title: "ZZ Yes task", due_date: "2099-01-17", priority: 3 })],
    [
      { match: answeredTool("propose_create_task"), reply: [said("Your task card is ready. Say create."), done, heard("yes create"), callTool("f2", "confirm_drafts")] },
      { match: answeredTool("confirm_drafts"), reply: [said("Created."), done] },
    ],
  );
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  await expect(page.getByTestId("draft-card")).toHaveAttribute("data-status", "done");
  expect(count("select count(*) from ops.task where title = 'ZZ Yes task'")).toBe(1);
  await page.getByRole("button", { name: "End voice call" }).click();
});

test("the microphone is closed while the assistant talks, and a tap on the circle cuts it off", async ({ browser }) => {
  const page = await ready(browser);
  const tone = Int16Array.from({ length: 24_000 * 4 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24_000)));
  const long = Buffer.from(tone.buffer).toString("base64");
  await script(page, [heard("Tell me something"), { serverContent: { modelTurn: { parts: [{ inlineData: { data: long, mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "Here is something long." } } }], []);
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Talk", exact: true }).click();

  await expect(page.getByText("Here is something long.")).toBeVisible();
  await expect(page.getByText("Tell me something")).toBeVisible();
  const interrupt = page.getByRole("button", { name: "Interrupt the assistant" });
  await expect(interrupt).toBeVisible();
  const before = frames;
  // The circle swells with the sound that is really being played, so this proves the speech was decoded and reached the speakers.
  await expect.poll(async () => Number(/scale\(([\d.]+)\)/.exec((await page.getByTestId("voice-ring").getAttribute("style")) ?? "")?.[1] ?? 1), { timeout: 3000 }).toBeGreaterThan(1.1);
  await page.waitForTimeout(1000);
  expect(frames - before).toBeLessThan(4);

  await interrupt.click();
  await expect(page.getByText("Go ahead, I’m listening.")).toBeVisible();
  const after = frames;
  await expect.poll(() => frames - after, { timeout: 5000 }).toBeGreaterThan(5);

  await page.getByRole("button", { name: "End voice call" }).click();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Here is something long.")).toBeVisible();
});

test("with headphones mode on, the microphone stays open while it talks", async ({ browser }) => {
  const page = await ready(browser);
  const long = Buffer.from(new Int16Array(24_000 * 4).fill(800).buffer).toString("base64");
  await script(page, [heard("Tell me more"), { serverContent: { modelTurn: { parts: [{ inlineData: { data: long, mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "Here is more." } } }], []);
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  await page.getByRole("switch", { name: "Talk over the assistant" }).click();
  await expect(page.getByText("Here is more.")).toBeVisible();
  const before = frames;
  await page.waitForTimeout(1000);
  expect(frames - before).toBeGreaterThan(8);
  await page.getByRole("button", { name: "End voice call" }).click();
});
