import { beforeEach, describe, expect, it, vi } from "vitest"
import { pageContent } from "@/lib/supabase/__tests__/tenant-fixture"

// Demo seed ids carry version nibble 0, which RFC 9562 uuid validation rejects.
const seedId = (n: number) => `a7000000-${"0000-".repeat(3)}${String(n).padStart(12, "0")}`

const state = vi.hoisted(() => ({
  orgId: "",
  rows: {} as Record<string, Record<string, unknown>[]>,
  filters: [] as Array<[string, string, unknown]>,
  rpcs: [] as Array<[string, Record<string, unknown>]>,
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: state.orgId, userId: "me", role: "owner" }), requireCapability: vi.fn() }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ ok: true }) }))
vi.mock("@/lib/queries/saved-views", () => ({ getFacetSavedViews: async () => [] }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string, args: Record<string, unknown>) => { state.rpcs.push([name, args]); return { error: null } },
  from: (table: string) => {
    let single = false
    const chain = {
      select: () => chain, insert: () => chain, update: () => chain, delete: () => chain,
      order: () => chain, range: () => chain, not: () => chain, is: () => chain,
      eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return chain },
      maybeSingle: () => { single = true; return chain },
      single: () => { single = true; return chain },
      then: (resolve: (value: unknown) => unknown) => {
        const data = state.rows[table] ?? []
        return resolve({ data: single ? data[0] ?? null : data, error: null })
      },
    }
    return chain
  },
}) }))

import { redirect } from "next/navigation"
import { createPurchaseBill, markBillPaid, receivePurchase, removePurchaseLine, transitionPurchase } from "@/app/(app)/purchases/actions"
import { sendPurchaseRFQ } from "@/app/(app)/purchases/email-actions"
import PurchasesPage from "@/app/(app)/purchases/page"
import { saveVendor } from "@/app/(app)/vendors/actions"

const orderId = seedId(2)
const lineId = seedId(3)
const vendorId = seedId(4)

beforeEach(() => { state.orgId = seedId(1); state.rows = {}; state.filters = []; state.rpcs = []; vi.mocked(redirect).mockClear() })

describe("purchasing accepts demo seed ids", () => {
  it("removes a purchase line by seed ids", async () => {
    expect(await removePurchaseLine(orderId, lineId)).toEqual({})
    expect(state.filters).toEqual([["purchase_order_items", "org_id", state.orgId], ["purchase_order_items", "purchase_order_id", orderId], ["purchase_order_items", "id", lineId]])
  })

  it("transitions a seed-id purchase", async () => {
    expect(await transitionPurchase(orderId, "confirmed")).toEqual({})
    expect(state.rpcs).toEqual([["transition_purchase_order", { p_org_id: state.orgId, p_order_id: orderId, p_status: "confirmed" }]])
  })

  it("receives a seed-id purchase", async () => {
    state.rows.purchase_order_items = [{ id: lineId, quantity: 2, received_quantity: 0 }]
    expect(await receivePurchase(orderId, [{ id: lineId, received_quantity: 1 }])).toEqual({})
    expect(state.rpcs).toEqual([["receive_purchase_order", { p_org_id: state.orgId, p_order_id: orderId, p_lines: [{ id: lineId, received_quantity: 1 }] }]])
  })

  it("bills a seed-id purchase", async () => {
    expect(await createPurchaseBill(orderId)).toEqual({})
    expect(state.rpcs).toEqual([["bill_purchase_order", { p_org_id: state.orgId, p_order_id: orderId }]])
  })

  it("marks a seed-id bill paid", async () => {
    expect(await markBillPaid(seedId(6))).toEqual({})
    expect(state.filters).toContainEqual(["costs", "id", seedId(6)])
  })

  it("sends the RFQ for a seed-id purchase", async () => {
    state.rows.purchase_orders = [{ id: orderId, number: "PO-1", status: "draft", order_date: "2026-10-01", expected_date: null, notes: null, vendors: { name: "Seed vendor", email: "vendor@example.com" } }]
    state.rows.purchase_order_items = [{ id: lineId, description: "Paper", quantity: 1, unit: "box", unit_cost_satang: 100 }]
    expect(await sendPurchaseRFQ(orderId)).toEqual({})
    expect(state.rpcs).toEqual([["transition_purchase_order", { p_org_id: state.orgId, p_order_id: orderId, p_status: "sent" }]])
  })

  it("filters the purchase list by a seed vendor id", async () => {
    state.rows.purchase_orders = [
      { id: orderId, number: "PO-SEED", vendor_id: vendorId, vendors: { name: "Seed vendor" }, status: "draft", order_date: "2026-10-01", expected_date: null, created_by: "me" },
      { id: lineId, number: "PO-OTHER", vendor_id: seedId(5), vendors: { name: "Other vendor" }, status: "draft", order_date: "2026-10-01", expected_date: null, created_by: "me" },
    ]
    const content = pageContent(await PurchasesPage({ searchParams: Promise.resolve({ vendor: vendorId }) }))
    expect(content).toContain("PO-SEED")
    expect(content).not.toContain("PO-OTHER")
  })

  it("updates a seed-id vendor", async () => {
    state.rows.vendors = [{ id: vendorId }]
    await saveVendor(vendorId, { name: "Seed vendor", tax_id: "", email: "", phone: "", address: "", payment_terms_days: 30, notes: "", active: true })
    expect(state.filters).toContainEqual(["vendors", "id", vendorId])
    expect(redirect).toHaveBeenCalledWith(`/vendors/${vendorId}`)
  })
})
