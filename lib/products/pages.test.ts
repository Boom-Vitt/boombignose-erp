import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  orgId: "b5000000-0000-4000-8000-000000000001", filters: [] as Array<[string, unknown]>,
  search: "", role: "owner",
  ranges: [] as Array<[number, number]>, limit: 0,
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: state.orgId, role: state.role }), requireCapability: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const chain = {
    select: () => chain, order: () => chain,
    range: (from: number, to: number) => { state.ranges.push([from, to]); return chain },
    limit: (limit: number) => { state.limit = limit; return chain },
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain },
    or: (value: string) => { state.search = value; return chain },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], count: 1040, error: null }),
  }
  return chain
} }) }))

import ProductsPage from "@/app/(app)/products/page"
import { activeProductOptions } from "./queries"

beforeEach(() => { state.filters = []; state.search = ""; state.ranges = []; state.limit = 0 })

describe("catalog list and picker queries", () => {
  it("normalizes repeated URL parameters before filtering", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ q: ["one", "two"], status: ["archived", "all"], page: ["2", "3"] }) })
    expect(state.search).toBe('name.ilike."%one%",sku.ilike."%one%"')
    expect(state.filters).toContainEqual(["active", false])
    expect(state.ranges).toEqual([[50, 99]])
  })

  it("fetches a stable page beyond the API row cap", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ page: "21" }) })
    expect(state.ranges).toEqual([[1000, 1049]])
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
