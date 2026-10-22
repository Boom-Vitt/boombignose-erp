import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ org: "b8200000-0000-4000-8000-000000000010", rows: {} as Record<string, Record<string, unknown>[]>, snapshot: {} as Record<string, unknown>, fail: "", mutate: false, ranges: [] as [string, number, number][], rpc: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: state.org, userId: "user" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: (table: string) => {
  const builder = {
    select: () => builder, eq: () => builder, order: () => builder,
    range: async (from: number, to: number) => {
      state.ranges.push([table, from, to])
      if (state.mutate && table === "stock_on_hand" && from === 1000) state.rows[table].unshift({ ...state.rows[table][0], warehouse_id: "new" })
      return { data: (state.rows[table] ?? []).slice(from, to + 1), error: table === state.fail ? new Error("Unavailable") : null }
    },
  }
  return builder
} }) }))
import { inventoryData, invoiceStockData } from "./queries"

const org = "b8200000-0000-4000-8000-000000000010"
const id = "b8200000-0000-4000-8000-000000000030"
const product = { id, org_id: org, name: "Product", sku: null, description: null, unit: "piece", type: "goods", is_stockable: true, active: true, list_price_satang: 200, cost_satang: 100, tax_rate_bps: 0, on_order: 0, reserved_quantity: 0, reorder_min: 5, reorder_qty: 10, default_vendor_id: null, created_at: "2026-10-23", updated_at: "2026-10-23" }

beforeEach(() => {
  state.org = org; state.rows = { products: [product] }; state.fail = ""; state.mutate = false; state.ranges = []
  state.snapshot = { products: [{ ...product, quantity: 0, value_satang: 0 }], balances: [] }
  state.rpc.mockReset().mockImplementation(async () => ({ data: state.snapshot, error: state.fail === "inventory_snapshot" ? new Error("Unavailable") : null }))
})

it("reads 1,001 balances in one snapshot even if an insertion would shift a later page", async () => {
  const balances = Array.from({ length: 1001 }, (_, i) => ({ org_id: org, product_id: id, warehouse_id: `b8200000-0000-4000-8000-${(i + 100).toString(16).padStart(12, "0")}`, quantity: 0.001, average_cost_satang: 101000, value_satang: 101 }))
  state.rows.stock_on_hand = [...balances]
  state.mutate = true
  state.snapshot = { products: [{ ...product, quantity: 1.001, value_satang: 101101 }], balances }
  const result = await inventoryData()
  expect(result.products[0]).toMatchObject({ quantity: 1.001, value_satang: 101101 })
  expect(result.balances).toHaveLength(1001)
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("inventory_snapshot", { p_org_id: org })
  expect(state.ranges.some(([table]) => table === "stock_on_hand")).toBe(false)
})

it("includes zero-stock products and passes warehouse/product filters to the snapshot", async () => {
  const result = await inventoryData("b8200000-0000-4000-8000-000000000020", id)
  expect(result.products[0]).toMatchObject({ quantity: 0, value_satang: 0, reorder_min: 5 })
  expect(state.rpc).toHaveBeenCalledWith("inventory_snapshot", { p_org_id: org, p_warehouse_id: "b8200000-0000-4000-8000-000000000020", p_product_id: id })
})

it("fails closed if the snapshot is unavailable or malformed", async () => {
  state.fail = "inventory_snapshot"
  await expect(inventoryData()).rejects.toThrow("Inventory data unavailable")
  state.fail = ""
  state.snapshot = { products: [{ ...product, quantity: 1, value_satang: Number.MAX_SAFE_INTEGER + 1 }], balances: [] }
  await expect(inventoryData()).rejects.toThrow("Inventory data unavailable")
})

it("accepts the PostgreSQL UUID format used by the seeded demo organization", async () => {
  state.org = "a0000000-0000-0000-0000-000000000001"
  state.snapshot = { products: [{ ...product, org_id: state.org, quantity: 0, value_satang: 0 }], balances: [] }
  const result = await inventoryData()
  expect(result.products[0].org_id).toBe(state.org)
})

it("reads complete issued stock lines and delivery evidence past the API cap", async () => {
  state.rows.invoice_stock_lines = Array.from({ length: 1001 }, (_, index) => ({ id: `line-${index}`, delivered_quantity: 1, returned_quantity: 0 }))
  state.rows.stock_moves = Array.from({ length: 1001 }, (_, index) => ({ id: `move-${index}`, kind: "delivery", source_line_id: `line-${index}` }))
  const result = await invoiceStockData(id)
  expect(result.lines).toHaveLength(1001)
  expect(result.moves).toHaveLength(1001)
  expect(state.ranges).toContainEqual(["invoice_stock_lines", 1000, 1999])
  expect(state.ranges).toContainEqual(["stock_moves", 1000, 1999])
})
