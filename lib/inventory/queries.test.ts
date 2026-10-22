import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: "", ranges: [] as [string, number, number][] }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "user" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const builder = {
    select: () => builder, eq: () => builder, order: () => builder,
    range: async (from: number, to: number) => {
      state.ranges.push([table, from, to])
      return { data: (state.rows[table] ?? []).slice(from, to + 1), error: table === state.fail ? new Error("Unavailable") : null }
    },
  }
  return builder
} }) }))
import { inventoryData } from "./queries"

beforeEach(() => { state.rows = {}; state.fail = ""; state.ranges = [] })

it("includes balances beyond the API row cap and fails closed on a later page error", async () => {
  state.rows.products = [{ id: "p", name: "Product" }]
  state.rows.stock_on_hand = Array.from({ length: 1001 }, (_, i) => ({ product_id: "p", warehouse_id: String(i), quantity: 0.001, value_satang: 101 }))
  const result = await inventoryData()
  expect(result.products[0]).toMatchObject({ quantity: 1.001, value_satang: 101101 })
  expect(state.ranges).toContainEqual(["stock_on_hand", 1000, 1999])
  state.fail = "stock_on_hand"
  await expect(inventoryData()).rejects.toThrow("Inventory data unavailable")
})

it("includes zero-stock products without ledger rows so replenishment can see them", async () => {
  state.rows.products = [{ id: "p", name: "Product", reorder_min: 5 }]
  const result = await inventoryData()
  expect(result.products[0]).toMatchObject({ quantity: 0, value_satang: 0, reorder_min: 5 })
})
