import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  orgId: "b5000000-0000-4000-8000-000000000001", available: true, status: "draft",
  inserted: [] as Record<string, unknown>[],
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: state.orgId, role: "owner" }),
  requireRole: vi.fn(), requireCapability: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const query = { table, filters: [] as Array<[string, unknown]> }
  state.queries.push(query)
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain },
    maybeSingle: async () => ({ data: table === "products" ? (state.available ? { id: productId } : null) : { status: state.status }, error: null }),
    insert: async (row: Record<string, unknown>) => { state.inserted.push(row); return { error: null } },
    then: (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null }),
  }
  return chain
} }) }))

import { addQuoteItem } from "@/app/(app)/quotes/actions"
import { addInvoiceItem } from "@/app/(app)/finance/invoice-items-actions"

const productId = "b5000000-0000-4000-8000-000000000002"
const line = { product_id: productId, description: "Negotiated scope", quantity: "2.5", unit: "day", unitPriceBaht: "1.01" }

beforeEach(() => { state.available = true; state.status = "draft"; state.inserted = []; state.queries = [] })

describe.each([
  ["quote", (values: typeof line) => addQuoteItem({ quote_id: "parent-id", ...values })],
  ["invoice", (values: typeof line) => addInvoiceItem({ invoice_id: "parent-id", ...values })],
] as const)("%s product line actions", (_kind, add) => {
  it("persists the user's snapshot and exact price after checking the active workspace product", async () => {
    expect(await add(line)).toEqual({})
    expect(state.inserted).toEqual([expect.objectContaining({ org_id: state.orgId, product_id: productId, description: "Negotiated scope", quantity: 2.5, unit: "day", unit_price_satang: 101, amount_satang: 253 })])
    expect(state.queries.find(query => query.table === "products")?.filters).toEqual([["org_id", state.orgId], ["id", productId], ["active", true]])
  })

  it("rejects archived, missing or other-workspace products without inserting a line", async () => {
    state.available = false
    expect(await add(line)).toEqual({ error: "Product unavailable. Choose an active product or a free-text line." })
    expect(state.inserted).toEqual([])
  })

  it("rejects forged product IDs before any database call", async () => {
    expect(await add({ ...line, product_id: "forged" })).toEqual({ error: "Invalid input" })
    expect(state.queries).toEqual([])
  })
})
