import { expect, test } from "@playwright/test";
import { resetDatabase, sidebarLabels, sql } from "./helpers";

// Password sign-in (Supabase Auth email + password) goes through the same invite check as Google and
// magic links: /auth/claim -> ops.claim_access(). Local stack only (see playwright.config.ts).
const EMAIL = "pw-founder@hardcode.local";
const PASSWORD = "correct-horse-battery";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetDatabase(EMAIL);
  // Create the auth user the way an admin would: confirmed email, bcrypt password.
  sql(`
    do $$ declare uid uuid := gen_random_uuid(); begin
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
        reauthentication_token, phone_change, phone_change_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', '${EMAIL}',
        extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid::text, uid, jsonb_build_object('sub', uid::text, 'email', '${EMAIL}', 'email_verified', true), 'email', now(), now(), now());
    end $$;`);
});

test("a wrong password is rejected without revealing which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("password sign-in claims the invite, then the password can be changed", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page).toHaveURL("/"); // the ?welcome=1 toast param is stripped after showing
  expect(await sidebarLabels(page)).toContain("Team");
  expect(sql(`select role from ops.staff where email = '${EMAIL}'`)).toBe("founder");

  await page.goto("/account");
  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
  await page.getByLabel("Confirm password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();
});
