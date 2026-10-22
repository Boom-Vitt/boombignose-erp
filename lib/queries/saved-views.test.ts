import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  filters: [] as [string, unknown][],
  error: false,
  config: undefined as unknown,
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query },
    order: () => query,
    then: (resolve: (result: unknown) => unknown) => resolve({
      error: state.error,
      data: [{ id: "view", name: "My sent quotes", config: state.config }],
    }),
  }
  return query
} }) }))

import { getFacetSavedViews } from "./saved-views"

beforeEach(() => {
  state.filters = []
  state.error = false
  state.config = { q: "Acme", status: "sent", mine: "1", groupBy: "client", period: "this_month", ignored: "unsafe", stage: "won" }
})

describe("facet saved views", () => {
  it("loads only this user's module in the active organization", async () => {
    const views = await getFacetSavedViews("quotes")
    expect(state.filters).toEqual([["org_id", "org"], ["user_id", "me"], ["module", "quotes"]])
    expect(views[0].config).toEqual({ q: "Acme", status: "sent", mine: "1", groupBy: "client", period: "this_month" })
  })
  it.each([
    { saved: { status: "draft,sent", mine: "1" }, loaded: { status: "draft,sent", mine: "1" } },
    { saved: { status: "sent,nope,draft,sent" }, loaded: { status: "draft,sent" } },
    { saved: { status: "draft" }, loaded: { status: "draft" } },
  ])("loads a saved status filter $saved as $loaded", async ({ saved, loaded }) => {
    state.config = saved
    expect((await getFacetSavedViews("quotes"))[0].config).toEqual(loaded)
  })
  it.each([{ config: null }, { config: [] }, { config: ["q", "Acme"] }])("ignores non-object config %j", async ({ config }) => {
    state.config = config
    const views = await getFacetSavedViews("clients")
    expect(views).toEqual([{ id: "view", name: "My sent quotes", config: {} }])
  })
  it("reports query failure instead of presenting an empty saved list", async () => {
    state.error = true
    await expect(getFacetSavedViews("quotes")).rejects.toThrow("Saved views unavailable")
  })
})
