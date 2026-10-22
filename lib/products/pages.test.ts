import { beforeEach, describe, expect, it, vi } from "vitest"
import { pageContent } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({
  orgId: "b5000000-0000-4000-8000-000000000001", filters: [] as Array<[string, unknown]>,
  search: "", role: "owner",
  ranges: [] as Array<[number, number]>, limit: 0,
  orders: [] as string[],
  product: { id: "a5000000-0000-0000-0000-000000000001", name: "CRM automation build", sku: "CRM-BUILD", description: null, type: "service", unit: "project", list_price_satang: 15000000, cost_satang: 9000000, tax_rate_bps: 0, is_stockable: false, active: true },
  rows: [] as Array<{ id: string; name: string; sku: null; type: string; unit: string; list_price_satang: number; active: boolean }>,
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: state.orgId, role: state.role }), requireCapability: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const chain = {
    select: () => chain,
    order: (name: string) => { state.orders.push(name); return chain },
    range: (from: number, to: number) => { state.ranges.push([from, to]); return chain },
    limit: (limit: number) => { state.limit = limit; return chain },
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain },
    or: (value: string) => { state.search = value; return chain },
    maybeSingle: async () => ({ data: state.product, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: state.rows, error: null }),
  }
  return chain
} }) }))

import ProductsPage from "@/app/(app)/products/page"
import ProductDetailPage from "@/app/(app)/products/[id]/page"
import EditProductPage from "@/app/(app)/products/[id]/edit/page"
import { activeProductOptions } from "./queries"

beforeEach(() => { state.filters = []; state.search = ""; state.ranges = []; state.limit = 0; state.orders = []; state.rows = [] })

describe("catalog list and picker queries", () => {
  it("normalizes repeated URL parameters before filtering", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ q: ["one", "two"], status: ["archived", "all"], page: ["2", "3"] }) })
    expect(state.search).toBe('name.ilike."%one%",sku.ilike."%one%"')
    expect(state.filters).toContainEqual(["active", false])
    expect(state.ranges).toEqual([[50, 100]])
  })

  it("fetches a stable page beyond the API row cap", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ page: "21" }) })
    expect(state.ranges).toEqual([[1000, 1050]])
    expect(state.orders).toEqual(["name", "id"])
  })

  it("renders 50 products and keeps search/status on navigation links", async () => {
    state.rows = Array.from({ length: 51 }, (_, i) => ({ id: String(i), name: `Product-${i}`, sku: null, type: "service", unit: "hour", list_price_satang: 100, active: false }))
    const content = pageContent(await ProductsPage({ searchParams: Promise.resolve({ q: "one", status: "archived", page: "2" }) }))
    expect(content).toContain("Product-49")
    expect(content).not.toContain("Product-50")
    expect(content).toContain("/products?status=archived&page=1&q=one")
    expect(content).toContain("/products?status=archived&page=3&q=one")
  })

  it.each(["0", "-1", "bad", "Infinity", "1.5", "9007199254740991"])("normalizes invalid page %s", async page => {
    await ProductsPage({ searchParams: Promise.resolve({ page }) })
    expect(state.ranges).toEqual([[0, 50]])
  })

  it("searches the server before limiting picker results", async () => {
    await activeProductOptions(" LATER-SKU ")
    expect(state.search).toBe('name.ilike."%LATER-SKU%",sku.ilike."%LATER-SKU%"')
    expect(state.limit).toBe(20)
    expect(state.filters).toEqual([["org_id", state.orgId], ["active", true]])
    expect(state.orders).toEqual(["name", "id"])
  })

  it("validates typeahead input before sending a query", async () => {
    await expect(activeProductOptions("x".repeat(201))).rejects.toThrow()
    expect(state.limit).toBe(0)
  })
  it("defaults to active products within the active organization", async () => {
    await ProductsPage({ searchParams: Promise.resolve({}) })
    expect(state.filters).toEqual([["org_id", state.orgId], ["active", true]])
  })

  it("filters archived products and quotes search values containing filter syntax", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ q: 'Training, "day"', status: "archived" }) })
    expect(state.filters).toEqual([["org_id", state.orgId], ["active", false]])
    expect(state.search).toBe('name.ilike."%Training, \\"day\\"%",sku.ilike."%Training, \\"day\\"%"')
  })

  it("allows an all-status search without dropping org scope", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ status: "all" }) })
    expect(state.filters).toEqual([["org_id", state.orgId]])
  })

  it("excludes archived and other-org products from picker options", async () => {
    expect(await activeProductOptions()).toEqual([])
    expect(state.filters).toEqual([["org_id", state.orgId], ["active", true]])
    expect(state.limit).toBe(20)
  })
})

describe("product routes", () => {
  it("opens a seed-shaped product id on the detail page", async () => {
    await ProductDetailPage({ params: Promise.resolve({ id: state.product.id }) })
    expect(state.filters).toContainEqual(["id", state.product.id])
  })

  it("opens a seed-shaped product id on the edit page", async () => {
    await EditProductPage({ params: Promise.resolve({ id: state.product.id }) })
    expect(state.filters).toContainEqual(["id", state.product.id])
  })
})
