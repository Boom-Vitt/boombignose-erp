import { beforeEach, expect, it, vi } from "vitest"
import { Children, isValidElement, type ReactNode } from "react"

const state = vi.hoisted(() => ({ role: "owner", pages: [] as number[] }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", role: state.role }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let from = 0
  let to = 999
  const invoices = Array.from({ length: 1001 }, (_, index) => ({ id: `invoice-${index}`, number: `INV-${index}`, status: "draft", quote_invoice_kind: "lines", quote_deposit_satang: 0 }))
  const rows: Record<string, unknown[]> = {
    quotes: [{ id: "quote", number: "QUO", status: "converted", valid_until: "2000-01-01", client_id: "client", project_id: null, total_satang: 100, subtotal_satang: 100, discount_satang: 0, clients: { name: "Client" } }],
    quote_items: [{ id: "line", description: "Service", quantity: 5, invoiced_quantity: 1, unit_price_satang: 100, amount_satang: 500, tax_rate_bps: 0 }],
    invoices,
  }
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    range: (start: number, end: number) => { from = start; to = end; if (table === "invoices") state.pages.push(start); return query },
    maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).slice(from, to + 1), error: null }),
  }
  return query
} }) }))

import QuoteDetailPage from "@/app/(app)/quotes/[id]/page"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons } from "@/components/record/smart-buttons"
import { CancelQuoteInvoiceButton } from "@/app/(app)/quotes/_components/cancel-quote-invoice-button"

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode), ...elements(child.props.value as ReactNode)] : [])
}

beforeEach(() => { state.role = "owner"; state.pages = [] })

it("offers another invoice for an accepted scope after conversion and validity expiry", async () => {
  const nodes = elements(await QuoteDetailPage({ params: Promise.resolve({ id: "quote" }) }))
  const bar = nodes.find((node) => node.type === StatusBar)!
  expect(bar.props.flow).toMatchObject({ next: { converted: { primary: { command: "convert" } } } })
  expect(bar.props.commands).toHaveProperty("convert")
})

it("links every invoice and counts beyond the API cap", async () => {
  const nodes = elements(await QuoteDetailPage({ params: Promise.resolve({ id: "quote" }) }))
  expect(state.pages).toEqual([0, 1000])
  expect(nodes.find((node) => node.type === SmartButtons)?.props.buttons).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Invoices", count: 1001, href: "#invoices" })]))
  expect(nodes.filter((node) => node.props.href === "/finance/invoices/invoice-1000")).toHaveLength(1)
  expect(nodes.filter((node) => node.type === CancelQuoteInvoiceButton)).toHaveLength(1001)
})

it("hides staff acceptance from ordinary members", async () => {
  state.role = "member"
  const nodes = elements(await QuoteDetailPage({ params: Promise.resolve({ id: "quote" }) }))
  const bar = nodes.find((node) => node.type === StatusBar)!
  expect(bar.props.flow).toMatchObject({ next: { sent: { primary: undefined } } })
  expect(bar.props.commands).not.toHaveProperty("convert")
  expect(nodes.filter((node) => node.type === CancelQuoteInvoiceButton)).toHaveLength(0)
})
