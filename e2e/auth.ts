import type { Page } from "@playwright/test"

export const demo = { email: "demo@boombignose.org", password: "BoomDemo123!" }

/** Signs in as the synthetic seeded owner (supabase/seed.sql) via the real form. */
export async function loginDemo(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(demo.email)
  await page.getByLabel("Password").fill(demo.password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL("**/dashboard")
}
