import { expect, test } from "@playwright/test"
import { loginDemo } from "./auth"

test("record history supports notes, attachments, scheduled activities and the personal queue", async ({ page }) => {
  test.setTimeout(90_000)
  await loginDemo(page)
  await page.goto("/clients")
  await page.locator('a[href^="/clients/"]').filter({ hasNotText: "New client" }).first().click()
  const history = page.getByRole("region", { name: "Record history", exact: true })
  await expect(history).toBeVisible()
  const unique = `History smoke ${Date.now()}`
  await history.getByLabel("Internal note").fill(unique)
  await history.getByRole("button", { name: "Log note", exact: true }).click()
  await expect(history.getByRole("region", { name: "Timeline", exact: true })).toContainText(unique)

  await history.getByRole("tab", { name: "Attach file" }).click()
  await history.getByLabel("Attachment", { exact: true }).setInputFiles({ name: "history-smoke.txt", mimeType: "text/plain", buffer: Buffer.from(unique) })
  await history.getByRole("button", { name: "Attach file", exact: true }).click()
  await expect(history.getByRole("button", { name: "Download history-smoke.txt" })).toBeVisible()

  await history.getByRole("tab", { name: "Schedule activity" }).click()
  await history.getByLabel("Due date").fill("2000-01-01")
  await history.getByLabel("Summary").fill(unique)
  await history.getByRole("button", { name: "Schedule activity", exact: true }).click()
  const planned = history.getByRole("region", { name: "Planned activities", exact: true })
  await expect(planned).toContainText(unique)
  await page.getByRole("link", { name: /^My activities:/ }).click()
  const overdue = page.getByRole("region", { name: "Overdue", exact: true })
  const row = overdue.getByRole("listitem").filter({ hasText: unique })
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: "Mark done", exact: true }).click()
  await expect(row).toHaveCount(0)
})
