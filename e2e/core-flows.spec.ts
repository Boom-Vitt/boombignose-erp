import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ retries: 0 })

async function expectDashboard(page: Page) {
  try {
    await page.waitForURL((url) => url.pathname === "/dashboard")
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible()
  } catch (error) {
    const names = (await page.context().cookies()).map((cookie) => cookie.name).join(" ")
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400)
    throw new Error(`url=${page.url()} cookies=${names || "(none)"} body=${text}`, { cause: error })
  }
}

test("sign up, sign in, and record a customer, stock count, and VAT invoice", async ({ page }) => {
  test.setTimeout(240_000)
  const email = `core-${randomUUID()}@example.com`
  const password = "Local-Core-19"
  const buyer = "Core buyer"
  const product = "Core goods"
  const reason = "Opening count"

  await page.goto("/signup")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create account", exact: true }).click()
  await page.waitForURL("**/onboarding")
  await page.getByLabel("Workspace name / ชื่อพื้นที่ทำงาน").fill("Core flow shop")
  await page.getByRole("button", { name: "Create workspace / สร้างพื้นที่ทำงาน", exact: true }).click()
  await expectDashboard(page)

  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await page.waitForURL((url) => url.pathname === "/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expectDashboard(page)

  await page.goto("/clients/new")
  await page.getByLabel("Name", { exact: true }).fill(buyer)
  await page.getByLabel("Tax ID", { exact: true }).fill("9876543210123")
  await page.getByRole("button", { name: "Create client", exact: true }).click()
  await page.waitForURL(/\/clients\/[^/]+$/)
  await expect(page.getByRole("heading", { name: buyer, exact: true })).toBeVisible()

  await page.goto("/products/new")
  await page.getByLabel("Name", { exact: true }).fill(product)
  await page.getByLabel("Type", { exact: true }).click()
  await page.getByRole("option", { name: "Goods", exact: true }).click()
  await page.getByLabel("Unit", { exact: true }).fill("piece")
  await page.getByLabel("Sales price (THB)").fill("20.00")
  await page.getByLabel("Cost (THB)").fill("10.00")
  await page.getByRole("checkbox", { name: "Stockable" }).check()
  await page.getByRole("button", { name: "Create product", exact: true }).click()
  await expect(page.getByRole("heading", { name: product, exact: true })).toBeVisible()
  const productId = new URL(page.url()).pathname.split("/").pop()!

  await page.goto("/inventory/warehouses")
  await page.getByLabel("Code", { exact: true }).fill("MAIN")
  await page.getByLabel("Name", { exact: true }).fill("Main warehouse")
  await page.getByRole("checkbox", { name: "Default warehouse", exact: true }).check()
  await page.getByRole("button", { name: "Create warehouse", exact: true }).click()
  const warehouse = page.getByRole("region", { name: "Main warehouse", exact: true })
  await expect(warehouse).toContainText("MAIN")
  await expect(warehouse.getByText("Default", { exact: true })).toBeVisible()

  await page.goto("/inventory/adjust")
  await page.getByLabel("Product", { exact: true }).selectOption({ label: product })
  await page.getByLabel("Counted quantity", { exact: true }).fill("4")
  await page.getByLabel("Unit cost (THB)", { exact: true }).fill("10.00")
  await page.getByLabel("Reason", { exact: true }).fill(reason)
  await page.getByRole("button", { name: "Record count", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Count recorded.")
  await page.goto(`/inventory?product=${productId}`)
  await expect(page.getByTestId(`on-hand-${productId}`)).toHaveText("4 piece")
  await page.goto("/inventory/moves")
  await expect(page.getByRole("cell", { name: "Adjustment In", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: reason, exact: true })).toBeVisible()

  await page.goto("/finance/business-profile")
  await page.getByLabel(/Legal business name/).fill("Core flow seller")
  await page.getByLabel(/Business address/).fill("Core flow address")
  await page.getByLabel(/Tax ID/).fill("1234567890123")
  await page.getByLabel("Branch", { exact: true }).fill("Head office")
  await page.getByRole("combobox", { name: "VAT status", exact: true }).selectOption("registered")
  await page.getByRole("button", { name: "Save business profile", exact: true }).click()
  await expect(page.getByText("Business profile saved")).toBeVisible()

  await page.goto("/finance/invoices/new")
  await page.getByRole("combobox", { name: "Client", exact: true }).click()
  await page.getByRole("option", { name: buyer, exact: true }).click()
  await page.getByRole("button", { name: "Create invoice", exact: true }).click()
  await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
  const lines = page.getByRole("form", { name: "Edit line items" })
  await lines.getByRole("button", { name: "Add a line", exact: true }).click()
  await lines.getByLabel("Description, row 1", { exact: true }).fill("Taxable consulting")
  await lines.getByLabel("Unit price, row 1", { exact: true }).fill("1000.00")
  await expect(lines.getByLabel("VAT, row 1", { exact: true })).toHaveValue("700")
  await lines.getByRole("button", { name: "Save lines", exact: true }).click()
  await expect(lines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
  const withholding = page.getByRole("combobox", { name: "Withholding tax", exact: true })
  await withholding.selectOption("300")
  await expect(withholding).toHaveValue("300")
  const totals = page.getByTestId("document-totals")
  for (const [label, amount] of [["Subtotal", "1,000.00"], ["Discount", "0.00"], ["VAT 7%", "70.00"], ["Total", "1,070.00"], ["WHT 3%", "30.00"], ["Amount due", "1,040.00"]]) {
    await expect(totals.getByText(label, { exact: true }).locator("..").locator("dd")).toContainText(amount)
  }

  const invoiceUrl = page.url()
  const bangkokToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  await page.goto("/settings/finance")
  await page.getByLabel("Lock transactions through", { exact: true }).fill(bangkokToday)
  await page.getByRole("button", { name: "Save finance lock", exact: true }).click()
  await expect(page.getByText("Finance lock date saved", { exact: true })).toBeVisible()
  await page.goto(invoiceUrl)
  await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
  await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
  await expect(page.getByText("Finance period is locked", { exact: true })).toBeVisible()

  await page.goto("/settings/finance")
  await page.getByLabel("Lock transactions through", { exact: true }).fill("")
  await page.getByRole("button", { name: "Save finance lock", exact: true }).click()
  await expect(page.getByText("Finance lock date saved", { exact: true })).toBeVisible()
  await page.goto(invoiceUrl)
  await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
  await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
  await expect(page.getByText("Issued snapshot retained. Corrections must preserve the original document.")).toBeVisible()
  await expect(page.getByRole("heading", { name: new RegExp(`^INV-${bangkokToday.slice(0, 4)}-000001$`) })).toBeVisible()
})
