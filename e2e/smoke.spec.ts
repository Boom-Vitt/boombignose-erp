import { test, expect } from "@playwright/test"

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/dashboard")
  await page.waitForURL("**/login**")
  await expect(page.getByText(/sign in to your workspace/i)).toBeVisible()
})

test("demo login lands on a populated dashboard", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: /use demo account/i }).click()
  await page.waitForURL("**/dashboard")
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  // Seeded data → the cash card renders
  await expect(page.getByText("Cash on hand")).toBeVisible()
})

test("can navigate to the core modules from the sidebar", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: /use demo account/i }).click()
  await page.waitForURL("**/dashboard")

  for (const name of ["Clients", "Deals", "Projects", "Finance", "Templates"]) {
    await page.getByRole("link", { name, exact: true }).first().click()
    await expect(page.getByRole("heading", { name })).toBeVisible()
  }
})
