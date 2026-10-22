import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  orgId: "b5000000-0000-4000-8000-000000000001", filters: [] as Array<[string, unknown]>,
  search: "", role: "owner",
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: state.orgId, role: state.role }), requireCapability: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const chain = {
    select: () => chain, order: () => chain,
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain },
    or: (value: string) => { state.search = value; return chain },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  }
  return chain
} }) }))

import ProductsPage from "@/app/(app)/products/page"
import { activeProductOptions } from "./queries"

beforeEach(() => { state.filters = []; state.search = "" })

describe("catalog list and picker queries", () => {
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
  })
})
