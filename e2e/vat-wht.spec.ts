import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

test("VAT-registered invoice with WHT 3% freezes and presents the same totals", async ({ page }) => {
  const org = randomUUID()
  const email = `vat-${randomUUID()}@example.invalid`
  const password = `Local-${randomUUID()}!`
  const token = randomUUID() + randomUUID()
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  expect(user.error).toBeNull()
  const uid = user.data.user!.id
  try {
    expect((await admin.from("organizations").insert({ id: org, name: "Synthetic VAT workspace", slug: `vat-${org}` })).error).toBeNull()
    expect((await admin.from("memberships").insert({ org_id: org, user_id: uid, role: "owner" })).error).toBeNull()
    const buyer = await admin.from("clients").insert({ org_id: org, name: "Synthetic VAT buyer", tax_id: "9876543210123", branch_label: "Branch 001", portal_enabled: true, portal_token: token }).select("id").single()
    expect(buyer.error).toBeNull()
    await page.goto("/login")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await page.waitForURL("**/dashboard")
    await page.goto("/finance/business-profile")
    await page.getByLabel(/Legal business name/).fill("Synthetic VAT seller")
    await page.getByLabel(/Business address/).fill("Synthetic seller address")
    await page.getByLabel(/Tax ID/).fill("1234567890123")
    await page.getByLabel("Branch", { exact: true }).fill("Head office")
    await page.getByLabel("VAT registered", { exact: true }).check()
    await page.getByRole("button", { name: "Save business profile", exact: true }).click()
    await expect.poll(async () => (await admin.from("org_settings").select("vat_registered").eq("org_id", org).single()).data?.vat_registered).toBe(true)
    await page.goto("/finance/invoices/new")
    await page.getByRole("combobox", { name: "Client", exact: true }).click()
    await page.getByRole("option", { name: "Synthetic VAT buyer", exact: true }).click()
    await page.getByRole("button", { name: "Create invoice", exact: true }).click()
    await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
    await page.getByLabel("Description", { exact: true }).fill("Taxable consulting")
    await page.getByLabel("Unit price (฿)", { exact: true }).fill("1000.00")
    await expect(page.getByLabel("VAT rate (bps)", { exact: true })).toHaveValue("700")
    await page.getByRole("button", { name: "Add item", exact: true }).click()
    await page.getByLabel("Withholding tax", { exact: true }).selectOption("300")
    const totals = page.getByTestId("document-totals")
    for (const [label, amount] of [["Subtotal", "1,000.00"], ["Discount", "0.00"], ["VAT 7%", "70.00"], ["Total", "1,070.00"], ["WHT 3%", "30.00"], ["Amount due", "1,040.00"]]) {
      await expect(totals.getByText(label, { exact: true }).locator("..").locator("dd")).toContainText(amount)
    }
    const invoiceUrl = page.url()
    await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
    await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
    await expect(page.getByText("Issued snapshot retained. Corrections must preserve the original document.")).toBeVisible()
    const pdf = await page.request.get(`${invoiceUrl}/pdf`)
    expect(pdf.ok()).toBe(true)
    const html = await pdf.text()
    for (const value of ["Tax Invoice / ใบกำกับภาษี", "VAT 7%", "WHT 3%", "1,040.00", "Head office", "Branch 001", "1234567890123", "9876543210123"]) expect(html).toContain(value)
    await page.goto(`/portal/${token}`)
    await expect(page.getByTestId("document-totals")).toContainText("1,040.00")
    await expect(page.getByTestId("document-totals")).toContainText("VAT 7%")
  } finally {
    expect((await admin.from("organizations").delete().eq("id", org)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(uid)).error).toBeNull()
  }
})
