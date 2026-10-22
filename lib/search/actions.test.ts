import { beforeEach, describe, expect, it, vi } from "vitest"

const ORG = "6a2f0c1d-5b3e-4c7a-8d9e-0f1a2b3c4d5e"
const ID = "3f1c2b6e-8a4d-4e2f-9b7a-1c2d3e4f5a6b"

const state = vi.hoisted(() => ({
  role: "member",
  records: {} as Record<string, unknown>,
  filters: [] as unknown[][],
  searchAllowed: true,
  rpc: [] as string[],
}))
const mocks = vi.hoisted(() => ({
  setQuoteStatus: vi.fn(async () => ({})),
  setSubscriptionStatus: vi.fn(async () => ({})),
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: ORG, role: state.role }) }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string) => {
      state.rpc.push(fn)
      return { data: state.searchAllowed, error: null }
    },
    from: (table: string) => {
      const chain = {
        select: () => chain, order: () => chain, limit: () => chain, range: () => chain,
        eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return chain },
        or: (value: string) => { state.filters.push([table, "or", value]); return chain },
        maybeSingle: async () => ({ data: state.records[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], count: 0, error: null }),
      }
      return chain
    },
  }),
}))
vi.mock("@/app/(app)/quotes/actions", () => ({ setQuoteStatus: mocks.setQuoteStatus }))
vi.mock("@/app/(app)/finance/subscription-actions", () => ({ setSubscriptionStatus: mocks.setSubscriptionStatus }))
vi.mock("@/app/(app)/deals/actions", () => ({ updateDealStage: vi.fn() }))
vi.mock("@/app/(app)/projects/actions", () => ({ updateProjectStatus: vi.fn() }))

import { recordActions, runRecordAction, searchRecords } from "./actions"

beforeEach(() => {
  state.role = "member"
  state.records = {}
  state.filters = []
  state.searchAllowed = true
  state.rpc = []
  vi.clearAllMocks()
})

describe("palette server actions", () => {
  it("runs only the status changes the record's StatusBar offers now", async () => {
    state.records.quotes = { status: "draft", valid_until: null }
    expect(await runRecordAction({ pathname: `/quotes/${ID}`, to: "accepted" })).toHaveProperty("error")
    expect(mocks.setQuoteStatus).not.toHaveBeenCalled()

    expect(await runRecordAction({ pathname: `/quotes/${ID}`, to: "sent" })).toEqual({})
    expect(mocks.setQuoteStatus).toHaveBeenCalledWith({ id: ID, status: "sent" })
  })

  it("keeps capability-gated transitions from members", async () => {
    state.records.subscriptions = { status: "active" }
    expect(await recordActions(`/finance/subscriptions/${ID}`)).toEqual([])
    expect(await runRecordAction({ pathname: `/finance/subscriptions/${ID}`, to: "paused" })).toHaveProperty("error")
    expect(mocks.setSubscriptionStatus).not.toHaveBeenCalled()

    state.role = "owner"
    expect(await recordActions(`/finance/subscriptions/${ID}`)).toEqual([
      { label: "Pause", to: "paused" },
      { label: "Cancel subscription", to: "cancelled" },
    ])
  })

  it("offers invoice commands as links to the page's own controls, staff only", async () => {
    state.records.invoices = { status: "draft", amount_satang: 10_000, due_date: null }
    expect(await recordActions(`/finance/invoices/${ID}`)).toEqual([])
    state.role = "admin"
    expect(await recordActions(`/finance/invoices/${ID}`)).toEqual([
      { label: "Issue invoice", href: `/finance/invoices/${ID}#issue-invoice` },
    ])
  })

  it("scopes every record search to the caller's org", async () => {
    await searchRecords("acme")
    const tables = ["clients", "deals", "quotes", "invoices", "projects", "products"]
    expect(state.filters.filter(([, key]) => key === "org_id")).toEqual(tables.map((t) => [t, "org_id", ORG]))
  })

  it("takes a per-user search slot before the fan-out and stops when none is left", async () => {
    state.searchAllowed = false
    expect(await searchRecords("acme")).toEqual({ hits: [], error: expect.stringMatching(/too many searches/i) })
    expect(state.rpc).toEqual(["take_search_slot"])
    expect(state.filters).toEqual([])
  })

  it("spends no slot or query on a term shorter than two characters", async () => {
    expect(await searchRecords("a")).toEqual({ hits: [] })
    expect(state.rpc).toEqual([])
    expect(state.filters).toEqual([])
  })
})
