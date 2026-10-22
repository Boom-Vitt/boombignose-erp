import { test, expect } from "@playwright/test"

import { loginDemo } from "./auth"

test.use({ viewport: { width: 1440, height: 900 } })

test("deals board scrolls inside its container, not the page, at 1440x900", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/deals")
  await expect(page.getByRole("region", { name: "Deals board" })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await expect(page.getByRole("link", { name: "New deal" }).first()).toBeInViewport()
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeInViewport()
  // Won and Lost start folded.
  await expect(page.getByRole("button", { name: /^Unfold Won/ })).toBeVisible()
})

test("projects board view renders status columns", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/projects?view=board")

  const board = page.getByRole("region", { name: "Projects board" })
  await expect(board).toBeVisible()
  await expect(board.getByRole("region", { name: "In progress", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "List" })).toBeVisible()
})
