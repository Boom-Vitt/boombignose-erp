import { test, expect } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { financeFixture } from "./finance-fixture"

test("partial and full credit notes retain original evidence, frozen tax and retry identity", async ({ page }) => {
  const f = await financeFixture()
  try {
    const invoice = await f.invoice([{ description: "Taxed service", unit_price_satang: 10000, tax_rate_bps: 700 }, { description: "Exempt service", unit_price_satang: 10000, tax_rate_bps: 0 }], 300)
    await f.login(page)
    await page.goto("/finance/business-profile")
    for (const status of ["unknown", "not_registered", "registered"]) {
      await page.getByRole("combobox", { name: "VAT status", exact: true }).selectOption(status)
      await page.getByRole("button", { name: "Save business profile", exact: true }).click()
      await expect.poll(async () => (await f.staff.from("org_settings").select("tax_status").eq("org_id", f.org).single()).data?.tax_status).toBe(status)
    }
    await page.goto(`/finance/invoices/${invoice.id}`)
    await page.getByLabel("Credit Taxed service", { exact: true }).fill("50.00")
    await page.getByLabel("Credit reason", { exact: true }).fill("Returned half of taxed service")
    await page.getByRole("button", { name: "Issue credit note", exact: true }).click()
    await expect.poll(async () => (await f.staff.from("invoice_balances").select("credited_satang").eq("invoice_id", invoice.id).single()).data?.credited_satang).toBe(5200)
    const note = page.getByRole("link", { name: /^CN-\d{4}-000001$/ })
    await expect(note).toBeVisible()
    const pdf = await page.context().newPage()
    await pdf.goto((await note.getAttribute("href"))!)
    await expect(pdf.getByRole("heading", { name: "Tax credit note / ใบลดหนี้", exact: true })).toBeVisible()
    await expect(pdf.getByText(invoice.number, { exact: true })).toBeVisible()
    await pdf.close()
    await page.getByLabel("Credit Taxed service", { exact: true }).fill("50.00")
    await page.getByLabel("Credit reason", { exact: true }).fill("Returned half of taxed service")
    await page.getByRole("button", { name: "Issue credit note", exact: true }).click()
    await expect.poll(async () => (await f.staff.from("credit_notes").select("id").eq("invoice_id", invoice.id)).data?.length).toBe(2)
    await page.getByLabel("Credit Exempt service", { exact: true }).fill("100.00")
    await page.getByLabel("Credit reason", { exact: true }).fill("Remaining services returned")
    let dropped = false
    await page.route(`**/finance/invoices/${invoice.id}`, async route => {
      if (!dropped && route.request().method() === "POST") { dropped = true; await route.fetch(); await route.abort("failed") }
      else await route.continue()
    })
    await page.getByRole("button", { name: "Issue credit note", exact: true }).click()
    await expect.poll(async () => (await f.staff.from("credit_notes").select("id").eq("invoice_id", invoice.id)).data?.length).toBe(3)
    await page.getByRole("button", { name: "Issue credit note", exact: true }).click()
    await expect(page.getByRole("button", { name: "Issue credit note", exact: true })).toHaveCount(0)
    const balance = await f.staff.from("invoice_balances").select("paid_satang, credited_satang, outstanding_satang").eq("invoice_id", invoice.id).single()
    expect(balance.data).toEqual({ paid_satang: 0, credited_satang: 20100, outstanding_satang: 0 })
    expect((await f.staff.from("invoices").select("status, amount_satang, issued_snapshot_id").eq("id", invoice.id).single()).data).toEqual({ status: "paid", amount_satang: 20100, issued_snapshot_id: invoice.snapshotId })
  } finally { await f.cleanup() }
})

test("issuing a final mixed-rate invoice creates deposit credit notes", async ({ page }) => {
  const f = await financeFixture()
  try {
    const quote = await f.staff.from("quotes").insert({ org_id: f.org, client_id: f.clientId, number: `MIXED-${randomUUID()}` }).select("id").single()
    expect(quote.error).toBeNull()
    const quoteId = quote.data!.id
    expect((await f.staff.from("quote_items").insert([{ org_id: f.org, quote_id: quoteId, description: "Exempt", unit_price_satang: 10000, tax_rate_bps: 0 }, { org_id: f.org, quote_id: quoteId, description: "Taxed", unit_price_satang: 10000, tax_rate_bps: 700 }])).error).toBeNull()
    expect((await f.staff.from("quotes").update({ status: "sent" }).eq("id", quoteId)).error).toBeNull()
    expect((await f.staff.from("quotes").update({ status: "accepted" }).eq("id", quoteId)).error).toBeNull()
    const deposit = await f.staff.rpc("convert_accepted_quote", { p_org_id: f.org, p_quote_id: quoteId, p_key: randomUUID(), p_deposit_satang: 10000 })
    expect(deposit.error).toBeNull()
    const draft = await f.staff.from("invoices").select("version").eq("id", deposit.data).single()
    expect((await f.staff.rpc("issue_invoice", { p_org_id: f.org, p_invoice_id: deposit.data, p_expected_version: draft.data!.version, p_key: randomUUID() })).error).toBeNull()
    const final = await f.staff.rpc("convert_accepted_quote", { p_org_id: f.org, p_quote_id: quoteId, p_key: randomUUID() })
    expect(final.error).toBeNull()
    await f.login(page)
    await page.goto(`/finance/invoices/${final.data}`)
    await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
    await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
    await expect.poll(async () => (await f.staff.from("credit_notes").select("amount_satang").eq("invoice_id", deposit.data)).data?.[0]?.amount_satang).toBe(10350)
    await page.goto(`/finance/invoices/${deposit.data}`)
    await expect(page.getByRole("link", { name: /^CN-/ })).toBeVisible()
  } finally { await f.cleanup() }
})
