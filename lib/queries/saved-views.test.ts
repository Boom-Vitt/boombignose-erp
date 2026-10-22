import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  filters: [] as [string, unknown][],
  error: false,
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query },
    order: () => query,
    then: (resolve: (result: unknown) => unknown) => resolve({
      error: state.error,
      data: [{ id: "view", name: "My sent quotes", config: { q: "Acme", status: "sent", mine: "1", groupBy: "client", period: "this_month", ignored: "unsafe", stage: "won" } }],
    }),
  }
  return query
} }) }))

import { getFacetSavedViews } from "./saved-views"

beforeEach(() => { state.filters = []; state.error = false })

describe("facet saved views", () => {
  it("loads only this user's module in the active organization", async () => {
    const views = await getFacetSavedViews("quotes")
    expect(state.filters).toEqual([["org_id", "org"], ["user_id", "me"], ["module", "quotes"]])
    expect(views[0].config).toEqual({ q: "Acme", status: "sent", mine: "1", groupBy: "client", period: "this_month" })
  })
  it("reports query failure instead of presenting an empty saved list", async () => {
    state.error = true
    await expect(getFacetSavedViews("quotes")).rejects.toThrow("Saved views unavailable")
  })
})
