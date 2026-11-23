import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a local Supabase stack (`npx supabase start`) and a production build
// of the app on port 3100 (an allowed redirect URL in supabase/config.toml). Magic-link emails are
// read from Mailpit. See e2e/README.md.
// Override with E2E_PORT when 3100 is taken. Password sign-in works on any port; magic-link tests need 3100.
const PORT = Number(process.env.E2E_PORT ?? 3100);

// The tests reset data, so they must NEVER talk to a hosted project. They build their own copy of the
// app (separate dist dir) pointed at the local Supabase stack, ignoring whatever .env.local says.
// Defaults are the public demo values every `supabase start` stack uses.
const LOCAL_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const LOCAL_KEY = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(LOCAL_URL)) {
  throw new Error(`E2E_SUPABASE_URL must be a local stack, got ${LOCAL_URL}`);
}
// The assistant's e2e talks to a stub Gemini server (e2e/gemini-stub.ts) with a throwaway vault key.
const STUB_PORT = Number(process.env.E2E_GEMINI_PORT ?? 3191);
const AI_ENV = `AI_KEY_SECRET=ZTJlLWFpLWtleS1zZWNyZXQtMzItYnl0ZXMhISEhISE= GEMINI_API_BASE=http://127.0.0.1:${STUB_PORT}`;
const env = `${AI_ENV} NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${LOCAL_KEY}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${env} npx next build && ${env} npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
  },
});
