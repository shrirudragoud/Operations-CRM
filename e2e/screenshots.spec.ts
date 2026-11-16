import { test } from "@playwright/test";
import { createPasswordUser, resetDatabase, signInWithPassword, sql } from "./helpers";

// Not a test: captures docs/screenshots for the Institutions workspace. Run with SCREENSHOTS=1 (local stack only).
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture");

const FOUNDER = "shots-founder@hardcode.local";
const PASSWORD = "correct-horse-battery";
const sizes = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

test("capture institutions screens", async ({ browser }) => {
  resetDatabase(FOUNDER);
  createPasswordUser(FOUNDER, PASSWORD);
  const names = ["ZZ Test College", "ZZ Demo Polytechnic", "ZZ Sample School", "ZZ Example University"];
  const kinds = ["engineering_college", "polytechnic", "school", "university"];
  const cities = ["Pune", "Nashik", "Nagpur", "Mumbai"];
  sql(`insert into ops.institution (name, kind, city, district) values ${names
    .map((n, i) => `('${n}', '${kinds[i]}', '${cities[i]}', '${cities[i]}')`)
    .join(",")}`);

  for (const [label, viewport] of Object.entries(sizes)) {
    const page = await (await browser.newContext({ viewport })).newPage();
    await signInWithPassword(page, FOUNDER, PASSWORD);
    const shot = (name: string) => page.screenshot({ path: `docs/screenshots/institutions-${name}-${label}.png`, fullPage: true });

    await page.goto("/institutions");
    await page.getByRole("link", { name: "ZZ Test College" }).waitFor();
    await shot("list");
    await page.goto("/institutions/new");
    await page.getByRole("combobox", { name: "Kind" }).waitFor();
    await shot("new");
    await page.goto("/institutions");
    await page.getByRole("link", { name: "ZZ Test College" }).click();
    await page.getByRole("heading", { name: "ZZ Test College" }).waitFor();
    await shot("360");
    await page.goto("/institutions/import");
    await page.getByLabel("CSV file").setInputFiles({
      name: "demo.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,kind,city\nZZ Test College,engineering_college,Pune\nZZ New One,school,Pune\nZZ Bad,nope,Pune\n"),
    });
    await page.getByRole("table", { name: "Rows with problems" }).waitFor();
    await shot("import");
    await page.context().close();
  }
});
