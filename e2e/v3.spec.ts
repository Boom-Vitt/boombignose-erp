import { test, expect, type Page } from "@playwright/test"

/**
 * V3 feature smoke tests: quotes, timesheets, and recurring subscriptions.
 * Assumes the local Supabase stack is running and seeded, with env loaded
 * (`set -a && . ./.env.local`). Assertions check structural presence, never
 * exact seeded money values (the seed may vary).
 */

async function loginDemo(page: Page) {
  await page.goto("/login")
  await page.getByRole("button", { name: /use demo account/i }).click()
  await page.waitForURL("**/dashboard")
}

test.describe("V3 routes", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000) // dev server compiles routes lazily on first hit
    await loginDemo(page)
  })

  test("sidebar exposes the Quotes and Timesheets modules", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: "Quotes", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Timesheets", exact: true })
    ).toBeVisible()
  })

  test("quotes list loads with a heading, a new-quote affordance, and a list or empty state", async ({
    page,
  }) => {
    await page.goto("/quotes")
    await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: /new quote/i }).first()
    ).toBeVisible()

    // Either a seeded table renders or the empty state does.
    const tables = await page.locator("table").count()
    const empty = await page.getByText(/no quotes yet/i).count()
    expect(tables + empty).toBeGreaterThan(0)
  })

  test("new quote page renders the quote form", async ({ page }) => {
    await page.goto("/quotes/new")
    await expect(page.getByRole("heading", { name: "New quote" })).toBeVisible()
    // Client select + quote number field.
    await expect(page.getByText("Client", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Quote number")).toBeVisible()
  })

  test("timesheets page renders stat cards and the log-time form", async ({
    page,
  }) => {
    await page.goto("/timesheets")
    await expect(page.getByRole("heading", { name: "Timesheets" })).toBeVisible()

    // Stat cards this-month.
    await expect(page.getByText("Hours this month")).toBeVisible()
    await expect(page.getByText("Utilization")).toBeVisible()

    // Log-time form: project select + hours input.
    await expect(page.getByText("Log time")).toBeVisible()
    await expect(page.getByText("Project", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Hours")).toBeVisible()
  })

  test("subscriptions list loads with a heading, a new-subscription affordance, and a list or empty state", async ({
    page,
  }) => {
    await page.goto("/finance/subscriptions")
    await expect(
      page.getByRole("heading", { name: "Subscriptions" })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /new subscription/i }).first()
    ).toBeVisible()

    const tables = await page.locator("table").count()
    const empty = await page.getByText(/no subscriptions yet/i).count()
    expect(tables + empty).toBeGreaterThan(0)
  })

  test("new subscription page renders the subscription form", async ({
    page,
  }) => {
    await page.goto("/finance/subscriptions/new")
    await expect(
      page.getByRole("heading", { name: "New subscription" })
    ).toBeVisible()
    // name + client + amount + interval.
    await expect(page.getByLabel("Name")).toBeVisible()
    await expect(page.getByText("Client", { exact: true })).toBeVisible()
    await expect(page.getByLabel(/amount/i)).toBeVisible()
    await expect(page.getByText("Interval", { exact: true })).toBeVisible()
  })

  test("a quote detail page shows line items and a PDF download", async ({
    page,
  }) => {
    await page.goto("/quotes")

    // Optional: only run when the seed has at least one quote (mirror how the
    // v2 specs guard optional rows). Skip gracefully otherwise.
    const rows = page.locator("table tbody tr")
    const count = await rows.count()
    test.skip(count === 0, "no seeded quotes to open")

    await rows.first().getByRole("link").first().click()
    await page.waitForURL("**/quotes/**")

    await expect(page.getByText("Line items")).toBeVisible()
    await expect(
      page.getByRole("link", { name: /download pdf/i })
    ).toBeVisible()
  })
})
