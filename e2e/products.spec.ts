import { test, expect } from "@playwright/test"
import { loginDemo } from "./auth"

test("catalog selection snapshots quote and invoice lines across product edits and archive", async ({ page }) => {
  const suffix = Date.now()
  const name = `Catalog smoke ${suffix}`
  const sku = `SMOKE-${suffix}`
  await loginDemo(page)
  await page.goto("/products/new")
  await page.getByLabel("Name", { exact: true }).fill(name)
  await page.getByLabel("SKU (optional)").fill(sku)
  await page.getByLabel("Unit", { exact: true }).fill("day")
  await page.getByLabel("Sales price (THB)").fill("1234.56")
  await page.getByLabel("Cost (THB)").fill("500.00")
  await page.getByRole("button", { name: "Create product", exact: true }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  const productUrl = page.url()

  const quotePath = "/quotes/90000000-0000-0000-0000-000000000001"
  const invoicePath = "/finance/invoices/f0000000-0000-0000-0000-000000000006"
  for (const path of [quotePath, invoicePath]) {
    await page.goto(path)
    const lines = page.getByRole("form", { name: "Edit line items" })
    await lines.getByRole("button", { name: "Add a line", exact: true }).click()
    const row = lines.locator('tr[data-row-kind="line"]').last()
    const picker = row.getByRole("combobox", { name: /^Product, row/ })
    await picker.click()
    await expect(picker).toHaveAttribute("aria-haspopup", "dialog")
    const popupId = await picker.getAttribute("aria-controls")
    expect(popupId).toBeTruthy()
    await expect(page.getByRole("dialog", { name: /^Product, row/ })).toHaveAttribute("id", popupId!)
    await page.getByRole("combobox", { name: "Search products by name or SKU" }).fill(sku)
    await page.getByRole("option", { name: new RegExp(name) }).click()
    await expect(row.getByRole("textbox", { name: /^Description, row/ })).toHaveValue(name)
    await expect(row.getByRole("textbox", { name: /^Unit, row/ })).toHaveValue("day")
    await expect(row.getByRole("textbox", { name: /^Unit price, row/ })).toHaveValue("1234.56")
    await lines.getByRole("button", { name: "Save lines", exact: true }).click()
    await expect(lines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
    await expect(row.getByRole("textbox", { name: /^Quantity, row/ })).toHaveValue("1")
  }

  await page.goto(`${productUrl}/edit`)
  await page.getByLabel("Sales price (THB)").fill("2000.00")
  await page.getByRole("button", { name: "Save product", exact: true }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Archive", exact: true }).click()
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible()

  for (const path of [quotePath, invoicePath]) {
    await page.goto(path)
    const lines = page.getByRole("form", { name: "Edit line items" })
    const row = lines.getByRole("row").filter({ has: page.locator(`input[value="${name}"]`) })
    await expect(row.getByRole("textbox", { name: /^Quantity, row/ })).toHaveValue("1")
    await expect(row.getByRole("textbox", { name: /^Unit, row/ })).toHaveValue("day")
    await expect(row.getByRole("textbox", { name: /^Unit price, row/ })).toHaveValue("1234.56")
    await lines.getByRole("button", { name: "Add a line", exact: true }).click()
    await lines.getByRole("combobox", { name: /^Product, row/ }).last().click()
    await page.getByRole("combobox", { name: "Search products by name or SKU" }).fill(sku)
    await expect(page.getByText("No matching products.", { exact: true })).toBeVisible()
    await expect(page.getByRole("option", { name: new RegExp(name) })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await lines.getByRole("button", { name: "Discard", exact: true }).click()
  }

  await page.goto(`/products?q=${encodeURIComponent(sku)}&status=archived`)
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
  await page.goto(`/products?q=${encodeURIComponent(sku)}&status=active`)
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0)
})

test("picker creates a product inline and keeps the line editable", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/quotes/90000000-0000-0000-0000-000000000001")
  const name = `Inline catalog ${Date.now()}`
  const lines = page.getByRole("form", { name: "Edit line items" })
  await lines.getByRole("button", { name: "Add a line", exact: true }).click()
  const row = lines.locator('tr[data-row-kind="line"]').last()
  await row.getByRole("combobox", { name: /^Product, row/ }).click()
  await page.getByRole("combobox", { name: "Search products by name or SKU" }).fill(name)
  await page.getByRole("option", { name: /^Create and edit/ }).click()
  const dialog = page.getByRole("dialog", { name: "Create product", exact: true })
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(name)
  await dialog.getByLabel("Sales price (THB)").fill("10.01")
  await dialog.getByRole("button", { name: "Create product", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(row.getByRole("textbox", { name: /^Description, row/ })).toHaveValue(name)
  await expect(row.getByRole("textbox", { name: /^Unit price, row/ })).toHaveValue("10.01")
  await row.getByRole("textbox", { name: /^Description, row/ }).fill(`${name} negotiated`)
  await row.getByRole("textbox", { name: /^Unit price, row/ }).fill("9.99")
  await lines.getByRole("button", { name: "Save lines", exact: true }).click()
  await expect(lines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(row.getByRole("textbox", { name: /^Description, row/ })).toHaveValue(`${name} negotiated`)
  await expect(row.getByRole("textbox", { name: /^Unit price, row/ })).toHaveValue("9.99")
})
