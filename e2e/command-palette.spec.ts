import { test, expect } from "@playwright/test"

import { loginDemo } from "./auth"

test("command palette opens from the keyboard and goes to Quotes", async ({ page }) => {
  await loginDemo(page)

  const palette = page.getByRole("dialog", { name: "Command palette" })
  // Retried: the shortcut listener attaches after hydration.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await expect(palette.getByRole("combobox", { name: "Search commands and records" })).toBeFocused()

  await page.keyboard.type("quotes")
  await expect(palette.getByRole("option", { name: "Quotes", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")

  await page.waitForURL("**/quotes")
  await expect(palette).toBeHidden()

  await page.keyboard.press("ControlOrMeta+k")
  await expect(palette).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(palette).toBeHidden()
})
