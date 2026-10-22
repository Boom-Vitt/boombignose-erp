import { beforeEach, expect, it, vi } from "vitest"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { databaseFixture, pageContent } from "@/lib/supabase/__tests__/tenant-fixture"
import { DocumentTotals } from "@/components/document-totals"
import { SmartButtons } from "@/components/record/smart-buttons"
import { WithholdingForm } from "@/app/(app)/finance/_components/withholding-form"

const state = vi.hoisted(() => ({ client: {} as unknown }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "A", userId: "user", role: "owner" }) }))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found") } }))
vi.mock("@edition", () => ({
  getInvoiceAccounting: async () => ({ connected: false, sync: null }),
  InvoiceAccountingControls: () => null, InvoiceAccountingStatus: () => null,
}))
import InvoicePage from "@/app/(app)/finance/invoices/[id]/page"
import QuotePage from "@/app/(app)/quotes/[id]/page"
import FinancePage from "@/app/(app)/finance/page"

const header = { id: "invoice", org_id: "A", client_id: "buyer", number: "VAT-1", status: "draft", amount_satang: 1040000, subtotal_satang: 1000000, discount_satang: 0, vat_satang: 70000, total_satang: 1070000, wht_satang: 30000, wht_rate_bps: 300, tax_breakdown: [], prices_include_vat: false, version: 1 }
const payments = Array.from({ length: 1501 }, (_, n) => ({ id: `payment-${n}`, org_id: "A", invoice_id: "invoice", amount_satang: 100, verification_state: "verified", paid_at: "2026-10-23" }))

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node, ...elements(node.props.children)]
}

beforeEach(() => { state.client = databaseFixture({ invoices: [header], payments, invoice_balances: [{ org_id: "A", invoice_id: "invoice", paid_satang: 150100 }] }) })

it("invoice detail keeps tax totals, SQL net balance, and a payment count beyond the row cap", async () => {
  const page = await InvoicePage({ params: Promise.resolve({ id: "invoice" }) })
  const nodes = elements(page)
  expect(nodes.find(node => node.type === DocumentTotals)?.props).toMatchObject({ vat: 70000, total: 1070000, wht: 30000, amountDue: 1040000 })
  expect(nodes.find(node => node.type === SmartButtons)?.props).toMatchObject({ buttons: expect.arrayContaining([expect.objectContaining({ label: "Payments", count: 1501 })]) })
  expect(pageContent(page)).toContain("8,899.00")
})

it("unpaid invoice draft still exposes the WHT selector after the balance-view merge", async () => {
  state.client = databaseFixture({ invoices: [header], invoice_balances: [{ org_id: "A", invoice_id: "invoice", paid_satang: 0 }] })
  const page = await InvoicePage({ params: Promise.resolve({ id: "invoice" }) })
  expect(elements(page).find(node => node.type === WithholdingForm)?.props).toMatchObject({ invoiceId: "invoice", rate: 300 })
})

it("quote detail keeps VAT totals and the true linked count when only one linked id is fetched", async () => {
  state.client = databaseFixture({ quotes: [{ ...header, id: "quote", project_id: "project", valid_until: null }], invoices: Array.from({ length: 1001 }, (_, n) => ({ id: `invoice-${n}`, org_id: "A", source_quote_id: "quote" })) })
  const page = await QuotePage({ params: Promise.resolve({ id: "quote" }) })
  const nodes = elements(page)
  expect(nodes.find(node => node.type === DocumentTotals)?.props).toMatchObject({ vat: 70000, total: 1070000 })
  expect(nodes.find(node => node.type === SmartButtons)?.props).toMatchObject({ buttons: expect.arrayContaining([expect.objectContaining({ label: "Invoices", count: 1001, href: "/projects/project#billing" })]) })
})

it("Finance keeps vendor bill metadata beyond the row cap alongside net receivables", async () => {
  const costs = Array.from({ length: 1001 }, (_, n) => ({ id: `cost-${n}`, org_id: "A", category: "software", amount_satang: 1, incurred_on: "2026-10-23", vendor: "Vendor", vendor_id: "vendor", purchase_order_id: "purchase", bill_number: `BILL-${n}`, due_date: "2026-10-22", paid_at: null }))
  state.client = databaseFixture({ invoices: [{ ...header, status: "sent" }], payments, costs })
  const content = pageContent(await FinancePage({ searchParams: Promise.resolve({}) }))
  expect(content).toContain("BILL-1000")
  expect(content).toContain("/purchases/purchase")
  expect(content).toContain("Mark paid")
  expect(content).toContain("8,899.00")
})
