import { expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

type Row = Record<string, unknown>
const { tables } = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }))

// In-memory stand-in for the service-role client: applies eq/in filters so the
// test sees exactly what the page's queries would return.
function from(table: string) {
  let rows = tables[table] ?? []
  const q = {
    select: () => q,
    order: () => q,
    eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
    in: (k: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[k]))), q),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  }
  return q
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }))
vi.mock("@/ee/portal/components/accept-quote-button", () => ({ AcceptQuoteButton: () => null }))
vi.mock("@/ee/portal/components/mark-invoice-paid-button", () => ({ MarkInvoicePaidButton: () => null }))
import ClientPortalPage from "@/app/portal/[token]/page"

const org = "org-1"
const client_id = "client-1"
const doc = (status: string, n: number) => ({ id: `${status}-${n}`, org_id: org, client_id, status })

it("portal lists only customer-facing quotes and invoices", async () => {
  Object.assign(tables, {
    clients: [{ id: client_id, name: "Client", org_id: org, portal_token: "tok", portal_enabled: true }],
    organizations: [{ id: org, name: "Org" }],
    projects: [],
    payments: [],
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
