import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Run SQL as the database owner (test setup only, never app code). */
export function sql(query: string): string {
  return execFileSync("psql", [DB_URL, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}

/** Reset ops data + auth users between runs so the gate starts from "only a founder invite". */
export function resetDatabase(founderEmail: string) {
  sql(`
    truncate ops.audit_log, ops.task, ops.feedback, ops.activity, ops.deal_line, ops.deal, ops.contact,
             ops.kpi_target, ops.invite cascade;
    alter table ops.staff disable trigger t_staff_last_founder;
    delete from ops.staff;
    alter table ops.staff enable trigger t_staff_last_founder;
    delete from auth.users;
    insert into ops.invite (email, full_name, role) values ('${founderEmail}', 'Local Founder', 'founder');
  `);
}

async function clearMailbox(email: string) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  const body = (await res.json()) as { messages: { ID: string }[] };
  if (body.messages.length) {
    await fetch(`${MAILPIT}/api/v1/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: body.messages.map((m) => m.ID) }),
    });
  }
}

async function latestLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { ID: string }[] };
    const id = body.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };
      const link = (msg.Text + msg.HTML).match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/)?.[0];
      if (link) return link.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No magic link email for ${email}`);
}

/** Full magic-link sign-in through the real login page, Supabase Auth and /auth/callback. */
export async function signInWithMagicLink(page: Page, email: string) {
  await clearMailbox(email);
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(`We sent a sign-in link to`)).toBeVisible();
  await page.goto(await latestLink(email));
}

export async function sidebarLabels(page: Page): Promise<string[]> {
  const links = page.locator('[data-sidebar="content"] a');
  await expect(links.first()).toBeVisible();
  return (await links.allInnerTexts()).map((t) => t.trim());
}
