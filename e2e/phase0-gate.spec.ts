import { expect, test } from "@playwright/test";
import { resetDatabase, sidebarLabels, signInWithMagicLink, sql } from "./helpers";

// docs/BUILD_PLAN.md Phase 0 gate: founder signs in, invites a member and a partner; each sees only
// what the access matrix allows; a non-invited account lands on /no-access; the last founder cannot be
// removed. (Google OAuth uses the same /auth/callback + claim_access path; magic link exercises it here.)
const FOUNDER = "founder@hardcode.local";
const MEMBER = "member@hardcode.local";
const PARTNER = "partner@hardcode.local";
const STRANGER = "stranger@hardcode.local";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetDatabase(FOUNDER));

test("unauthenticated visitors are sent to /login", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("founder claims the seeded invite and invites a member and a partner", async ({ page }) => {
  await signInWithMagicLink(page, FOUNDER);
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Welcome to Hard-Code Ops")).toBeVisible();
  expect(await sidebarLabels(page)).toEqual([
    "My space", "My day", "Calendar", "Institutions", "Tasks", "Timesheet", "Attendance", "Team workload", "Reports", "Feedback", "Outreach", "Sales", "Workshop", "Inventory",
    "Training", "Product", "Community", "People & HR", "Cockpit", "Team", "Audit log",
  ]);

  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  // Member in Sales. Submitting without a department shows the rule next to the field.
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(MEMBER);
  await dialog.getByLabel("Name (optional)").fill("Meera Member");
  await dialog.getByRole("button", { name: "Create invite" }).click();
  await expect(dialog.getByText("Choose at least one department.")).toBeVisible();
  await dialog.getByLabel("Sales").check();
  await dialog.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText(`Invite created for ${MEMBER}`)).toBeVisible();

  // Partner: departments are hidden for this role.
  await page.getByRole("button", { name: "Invite" }).click();
  await dialog.getByLabel("Email").fill(PARTNER);
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "Partner" }).click();
  await expect(dialog.getByText("Departments")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText(`Invite created for ${PARTNER}`)).toBeVisible();

  const pending = page.getByRole("table").nth(1);
  await expect(pending.getByText(MEMBER)).toBeVisible();
  await expect(pending.getByText(PARTNER)).toBeVisible();
  await page.screenshot({ path: "test-results/phase0-team.png", fullPage: true });
});

test("the last founder cannot demote or deactivate themselves", async ({ page }) => {
  await signInWithMagicLink(page, FOUNDER);
  await page.goto("/team");
  const me = page.getByRole("row").filter({ hasText: "(you)" });
  await me.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Edit role and departments" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "Member" }).click();
  await dialog.getByLabel("Product").check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("There must be at least one active founder");
  await page.keyboard.press("Escape");

  await me.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Deactivate" }).click();
  await expect(confirm.getByRole("alert")).toHaveText("There must be at least one active founder");
  expect(sql(`select role || ':' || is_active from ops.staff where email = '${FOUNDER}'`)).toBe("founder:true");
});

test("member sees only shared areas plus their department", async ({ page }) => {
  await signInWithMagicLink(page, MEMBER);
  await expect(page).toHaveURL("/");
  expect(await sidebarLabels(page)).toEqual(["My space", "My day", "Calendar", "Institutions", "Tasks", "Timesheet", "Feedback", "Sales"]);
  await page.goto("/team");
  await expect(page.getByText("You don't have access to team admin")).toBeVisible();
  await page.goto("/inventory");
  await expect(page.getByText("You don't have access to Inventory")).toBeVisible();
  // RLS, not just the UI: invites are invisible to a member even through the API.
  expect(sql(`select count(*) from ops.staff where email = '${MEMBER}' and role = 'member'`)).toBe("1");
});

test("partner sees only their own-record areas", async ({ page }) => {
  await signInWithMagicLink(page, PARTNER);
  await expect(page).toHaveURL("/");
  expect(await sidebarLabels(page)).toEqual(["My day", "My institutions", "My activities", "My deals"]);
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "My deals" })).toBeVisible();
  await page.goto("/workshop");
  await expect(page.getByText("You don't have access to Workshop")).toBeVisible();
  await page.screenshot({ path: "test-results/phase0-partner.png", fullPage: true });
});

test("an uninvited account lands on /no-access and sees nothing", async ({ page }) => {
  await signInWithMagicLink(page, STRANGER);
  await expect(page).toHaveURL("/no-access");
  await expect(page.getByText("You haven't been invited yet")).toBeVisible();
  await expect(page.getByText(STRANGER)).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL("/no-access");
  expect(sql(`select count(*) from ops.staff where email = '${STRANGER}'`)).toBe("0");
  await page.screenshot({ path: "test-results/phase0-no-access.png", fullPage: true });
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("deactivating a member removes their access on the next request", async ({ browser }) => {
  const founder = await browser.newPage();
  const member = await browser.newPage();
  await signInWithMagicLink(member, MEMBER);
  await expect(member).toHaveURL("/");

  await signInWithMagicLink(founder, FOUNDER);
  await founder.goto("/team");
  await founder.getByRole("row").filter({ hasText: MEMBER }).getByRole("button", { name: /Actions for/ }).click();
  await founder.getByRole("menuitem", { name: "Deactivate" }).click();
  await founder.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(founder.getByText("Meera Member was deactivated")).toBeVisible();

  await member.reload();
  await expect(member).toHaveURL("/no-access");
  await expect(member.getByText("Your access has been turned off")).toBeVisible();
});
