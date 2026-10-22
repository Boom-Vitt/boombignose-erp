import { test, expect, type Page } from "@playwright/test"

import { loginDemo } from "./auth"

/**
 * Record header smoke: breadcrumbs, the status bar and smart buttons on seeded
 * records (supabase/seed.sql). QUO-2026-001 and INV-2026-001 both link to a project.
 */

async function expectRecordHeader(page: Page, root: string, statusList: string) {
  await expect(
    page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: root })
  ).toBeVisible()
  const stages = page.getByRole("list", { name: statusList })
  await expect(stages).toBeVisible()
  await expect(stages.locator('[aria-current="step"]')).toHaveCount(1)
  await expect(
    page.getByRole("navigation", { name: "Related records" }).getByRole("link", { name: /Project/ })
  ).toBeVisible()
}

test("quote detail shows breadcrumbs, status bar and a linked project", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/quotes")
  await page.getByRole("link", { name: "QUO-2026-001" }).first().click()
  await expect(page.getByRole("heading", { name: "QUO-2026-001" })).toBeVisible()
  await expectRecordHeader(page, "Quotes", "Quote status")
})

test("invoice detail shows breadcrumbs, status bar and a linked project", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/finance")
  await page.getByRole("link", { name: "INV-2026-001" }).first().click()
  await expect(page.getByRole("heading", { name: "INV-2026-001" })).toBeVisible()
  await expectRecordHeader(page, "Finance", "Invoice status")
})
