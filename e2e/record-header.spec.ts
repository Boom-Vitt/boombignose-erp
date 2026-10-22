import { test, expect, type Page } from "@playwright/test"

import { loginDemo } from "./auth"

/**
 * Record header smoke: breadcrumbs, the status bar and smart buttons on seeded
 * records (supabase/seed.sql), including the first issued invoice with a project.
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
  const invoice = page.getByRole("link", { name: /^INV-[0-9]{4}-000001$/ }).first()
  const number = await invoice.innerText()
  await invoice.click()
  await expect(page.getByRole("heading", { name: number })).toBeVisible()
  await expectRecordHeader(page, "Finance", "Invoice status")
})
