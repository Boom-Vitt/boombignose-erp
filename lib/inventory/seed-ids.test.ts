import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  orgId: "a0000000-0000-0000-0000-000000000001",
  rpc: vi.fn(), filters: [] as [string, unknown][], insert: vi.fn(), update: vi.fn(),
  inventoryData: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: state.orgId, userId: "owner", role: "owner" }), requireCapability: vi.fn() }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/inventory/queries", () => ({ inventoryData: state.inventoryData }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: state.rpc,
  from: () => {
    const chain = {
      insert: state.insert, update: state.update,
      eq: (column: string, value: unknown) => { state.filters.push([column, value]); return chain },
      select: () => chain,
      maybeSingle: async () => ({ data: { id: product }, error: null }),
    }
    state.insert.mockResolvedValue({ error: null })
    state.update.mockReturnValue(chain)
    return chain
  },
}) }))

import { redirect } from "next/navigation"
import { adjustStock, createReplenishment, deleteWarehouse, deliverInvoice, saveReorder, saveWarehouse } from "./actions"
import { CountInput } from "./schema"
import InventoryPage from "@/app/(app)/inventory/page"
import { createSavedView } from "@/app/(app)/views/actions"

const warehouse = "a9000000-0000-0000-0000-000000000001"
const product = "a9000000-0000-0000-0000-000000000002"
const vendor = "a9000000-0000-0000-0000-000000000003"
const invoice = "a9000000-0000-0000-0000-000000000004"
const key = "a9000000-0000-4000-8000-000000000005"

beforeEach(() => {
  vi.clearAllMocks()
  state.filters = []
  state.rpc.mockResolvedValue({ data: invoice, error: null })
  state.inventoryData.mockResolvedValue({ products: [], warehouses: [] })
})

it("saves and deletes a warehouse with a PostgreSQL seed id", async () => {
  expect(await saveWarehouse({ id: warehouse, code: "MAIN", name: "Main", address: "", is_default: true, active: true })).toEqual({})
  expect(state.rpc).toHaveBeenCalledWith("save_warehouse", expect.objectContaining({ p_org_id: state.orgId, p_id: warehouse }))
  expect(await deleteWarehouse(warehouse)).toEqual({})
  expect(state.rpc).toHaveBeenCalledWith("delete_warehouse", { p_org_id: state.orgId, p_id: warehouse })
})

it("posts a count for seeded product and warehouse ids while retaining an RFC UUID command key", async () => {
  const count = { product_id: product, warehouse_id: warehouse, quantity: 3, reason: "Cycle count", key }
  expect(await adjustStock(count)).toEqual({})
  expect(state.rpc).toHaveBeenCalledWith("adjust_stock", { p_org_id: state.orgId, p_product_id: product, p_warehouse_id: warehouse, p_count: 3, p_reason: "Cycle count", p_key: key })
  expect(CountInput.safeParse({ ...count, key: warehouse }).success).toBe(false)
})

it("delivers a seed-id invoice to a seed-id warehouse", async () => {
  expect(await deliverInvoice(invoice, warehouse)).toEqual({})
  expect(state.rpc).toHaveBeenCalledWith("deliver_invoice", { p_org_id: state.orgId, p_invoice_id: invoice, p_warehouse_id: warehouse })
})

it("saves replenishment with seeded product and vendor ids under the current organization", async () => {
  expect(await saveReorder({ product_id: product, reorder_min: 5, reorder_qty: 10, default_vendor_id: vendor })).toEqual({})
  expect(state.update).toHaveBeenCalledWith({ reorder_min: 5, reorder_qty: 10, default_vendor_id: vendor })
  expect(state.filters).toEqual([["org_id", state.orgId], ["id", product], ["is_stockable", true]])
})

it("creates a replenishment RFQ for a seed-id vendor", async () => {
  await createReplenishment(vendor)
  expect(state.rpc).toHaveBeenCalledWith("create_replenishment_rfq", { p_org_id: state.orgId, p_vendor_id: vendor })
  expect(redirect).toHaveBeenCalledWith(`/purchases/${invoice}`)
})

it("applies seed-id product and warehouse filters to the inventory page", async () => {
  await InventoryPage({ searchParams: Promise.resolve({ product, warehouse }) })
  expect(state.inventoryData).toHaveBeenCalledWith(warehouse, product)
})

it("persists inventory saved-view filters with seed database ids", async () => {
  const config = { warehouse, product, sourceId: invoice }
  expect(await createSavedView({ module: "inventory", name: "Seed stock", config })).toEqual({})
  expect(state.insert).toHaveBeenCalledWith({ org_id: state.orgId, user_id: "owner", module: "inventory", name: "Seed stock", config })
})
