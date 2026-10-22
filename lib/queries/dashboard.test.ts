import { afterEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ verified: false }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const filters: [string, unknown][] = []
  const chain = {
    range: () => chain,
    order: () => chain,
    select: () => chain,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return chain },
    gte: () => chain, lt: () => chain, in: () => chain,
    maybeSingle: async () => ({ data: { monthly_burn_satang: null, cash_balance_satang: 85_000_000 }, error: null }),
    then: (resolve: (result: unknown) => unknown) => {
      const receipts = [
        { invoice_id: "invoice", paid_at: "2026-10-01T09:00:00Z", amount_satang: 9_000_000 },
        { invoice_id: "invoice", paid_at: "2026-10-23T05:00:00Z", amount_satang: 4_000_000 },
      ]
      const data = table === "payments"
        ? receipts.filter(() => state.verified || !filters.some(([key, value]) => key === "verification_state" && value === "verified"))
        : table === "costs" ? [12_000_000, 1_500_000, 800_000, 2_500_000, 2_000_000].map((amount_satang) => ({ amount_satang, incurred_on: "2026-10-01" })) : []
      return resolve({ data, error: null, count: 0 })
    },
  }
  return chain
} }) }))

import { getDashboardData } from "./dashboard"

afterEach(() => { vi.useRealTimers(); state.verified = false })

describe("dashboard verified-receipt definition", () => {
  it("excludes legacy unverified seed receipts while counting current-month costs", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-23T06:00:00Z"))
    const data = await getDashboardData()
    expect(data.monthlyRevenueSatang).toBe(0)
    expect(data.monthlyBurnSatang).toBe(18_800_000)
    state.verified = true
    expect((await getDashboardData()).monthlyRevenueSatang).toBe(13_000_000)
  })
})
