import { describe, it, expect } from "vitest"

import {
  projectProfit,
  type InvoiceForProfit,
  type CostForProfit,
} from "@/lib/metrics/projects"

describe("projectProfit", () => {
  const invoices: InvoiceForProfit[] = [
    { status: "paid", amount_satang: 500_000 },
    { status: "sent", amount_satang: 300_000 },
    { status: "draft", amount_satang: 100_000 },
    { status: "cancelled", amount_satang: 200_000 },
  ]
  const costs: CostForProfit[] = [
    { amount_satang: 200_000 },
    { amount_satang: 100_000 },
  ]

  it("computes revenue, cost, profit, and margin", () => {
    const r = projectProfit(invoices, costs)
    expect(r.revenueSatang).toBe(800_000) // paid + sent (draft/cancelled excluded)
    expect(r.costSatang).toBe(300_000)
    expect(r.profitSatang).toBe(500_000)
    expect(r.marginPct).toBeCloseTo(62.5, 5)
  })

  it("handles zero revenue without dividing by zero", () => {
    const r = projectProfit([], [{ amount_satang: 50_000 }])
    expect(r.revenueSatang).toBe(0)
    expect(r.costSatang).toBe(50_000)
    expect(r.profitSatang).toBe(-50_000)
    expect(r.marginPct).toBe(0)
  })
})
