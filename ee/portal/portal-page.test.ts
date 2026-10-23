import { expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

type Row = Record<string, unknown>
const { tables } = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }))

// In-memory stand-in for the service-role client: applies eq/in filters so the
// test sees exactly what the page's queries would return.
function from(table: string) {
  let rows = tables[table] ?? []
  const q = {
    range: (from: number, to: number) => ((rows = rows.slice(from, to + 1)), q),
    select: () => q,
    order: () => q,
    eq: (k: string, v: unknown) => ((rows = rows.filter((r) => k === "invoices.client_id" ? tables.invoices?.some(invoice => invoice.id === r.invoice_id && invoice.client_id === v) : r[k] === v)), q),
    in: (k: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[k]))), q),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }))
vi.mock("@/ee/portal/components/accept-quote-button", () => ({ AcceptQuoteButton: () => null }))
vi.mock("@/ee/portal/components/mark-invoice-paid-button", () => ({ MarkInvoicePaidButton: () => null }))
import ClientPortalPage from "./page"

const org = "org-1"
const client_id = "client-1"
const doc = (status: string, n: number) => ({ id: `${status}-${n}`, org_id: org, client_id, status })

it("portal lists only customer-facing quotes and invoices", async () => {
  Object.assign(tables, {
    clients: [{ id: client_id, name: "Client", org_id: org, portal_token: "tok", portal_enabled: true }],
    organizations: [{ id: org, name: "Org" }],
    projects: [],
    payments: [], invoice_balances: [],
    invoice_items: [],
    payment_claims: [],
    quotes: ["draft", "sent", "accepted", "declined", "expired", "converted"].map((s, i) => ({
      ...doc(s, i),
      number: `QUOTE-${s}`,
      total_satang: 100,
    })),
    invoices: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"].map((s, i) => ({
      ...doc(s, i),
      number: `INVOICE-${s}`,
      amount_satang: 100,
      issue_date: "2026-10-01",
      due_date: null,
    })),
  })

  const html = renderToStaticMarkup(await ClientPortalPage({ params: Promise.resolve({ token: "tok" }) }))

  const shown = [...html.matchAll(/>((?:QUOTE|INVOICE)-\w+)</g)].map((m) => m[1]).sort()
  expect(shown).toEqual(
    [
      ...["sent", "accepted", "declined", "expired", "converted"].map((s) => `QUOTE-${s}`),
      ...["sent", "partially_paid", "paid", "overdue"].map((s) => `INVOICE-${s}`),
    ].sort()
  )
})

it("portal shows gross VAT totals, net amount due and verified outstanding", async () => {
  Object.assign(tables, {
    clients: [{ id: client_id, name: "Client", org_id: org, portal_token: "vat-token", portal_enabled: true }],
    organizations: [{ id: org, name: "Org" }], projects: [], quotes: [], payment_claims: [], invoice_items: [],
    invoices: [{ ...doc("sent", 1), number: "VAT-1", amount_satang: 104000, subtotal_satang: 100000, discount_satang: 0, vat_satang: 7000, total_satang: 107000, wht_satang: 3000, wht_rate_bps: 300, tax_breakdown: [{ rateBps: 700, baseSatang: 100000, vatSatang: 7000 }], issue_date: "2026-10-01", due_date: null }],
    invoice_balances: [{ org_id: org, client_id, invoice_id: "sent-1", paid_satang: 4000, credited_satang: 0 }],
    payments: [{ id: "paid", invoice_id: "sent-1", org_id: org, amount_satang: 4000, verification_state: "verified" }, { id: "legacy", invoice_id: "sent-1", org_id: org, amount_satang: 100000, verification_state: "legacy_unverified" }],
  })
  const html = renderToStaticMarkup(await ClientPortalPage({ params: Promise.resolve({ token: "vat-token" }) }))
  for (const text of ["VAT 7%", "WHT 3%", "1,070.00", "1,040.00", "1,000.00"]) expect(html).toContain(text)
})
