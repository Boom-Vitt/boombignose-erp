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
    const picker = page.getByRole("combobox", { name: "Product (optional)" })
    await picker.click()
    await expect(picker).toHaveAttribute("aria-haspopup", "dialog")
    const popupId = await picker.getAttribute("aria-controls")
    expect(popupId).toBeTruthy()
    await expect(page.getByRole("dialog", { name: "Product (optional)" })).toHaveAttribute("id", popupId!)
    await page.getByRole("combobox", { name: "Search products by name or SKU" }).fill(sku)
    await page.getByRole("option", { name: new RegExp(name) }).click()
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(name)
    await expect(page.getByLabel("Unit", { exact: true })).toHaveValue("day")
    await expect(page.getByLabel("Unit price (฿)")).toHaveValue("1234.56")
    await page.getByRole("button", { name: path === quotePath ? "Add" : "Add item", exact: true }).click()
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("1 day")
  }

  await page.goto(`${productUrl}/edit`)
  await page.getByLabel("Sales price (THB)").fill("2000.00")
  await page.getByLabel("Unit", { exact: true }).fill("hour")
  await page.getByRole("button", { name: "Save product", exact: true }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Archive", exact: true }).click()
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible()

  for (const path of [quotePath, invoicePath]) {
    await page.goto(path)
    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row).toContainText("1 day")
    await expect(row).toContainText("1,234.56")
    await page.getByRole("combobox", { name: "Product (optional)" }).click()
    await page.getByRole("combobox", { name: "Search products by name or SKU" }).fill(sku)
    await expect(page.getByRole("option", { name: new RegExp(name) })).toHaveCount(0)
    await page.keyboard.press("Escape")
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
  await page.getByRole("combobox", { name: "Product (optional)" }).click()
  await page.getByRole("combobox", { name: "Search products by name or SKU" }).fill(name)
  await page.getByRole("option", { name: "Create product", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create product", exact: true })
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(name)
  await dialog.getByLabel("Sales price (THB)").fill("10.01")
  await dialog.getByRole("button", { name: "Create product", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(name)
  await expect(page.getByLabel("Unit price (฿)")).toHaveValue("10.01")
  await page.getByLabel("Description", { exact: true }).fill(`${name} negotiated`)
  await page.getByLabel("Unit price (฿)").fill("9.99")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("row").filter({ hasText: `${name} negotiated` })).toContainText("9.99")
})
