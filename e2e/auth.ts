import type { Page } from "@playwright/test"

/** Signs in as the synthetic seeded owner (supabase/seed.sql) via the real form. */
export async function loginDemo(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Email").fill("demo@boombignose.org")
  await page.getByLabel("Password").fill("BoomDemo123!")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL("**/dashboard")
}
