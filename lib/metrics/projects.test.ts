import { describe, it, expect } from "vitest"

import {
  projectProfit,
  type InvoiceForProfit,
  type CostForProfit,
} from "@/lib/metrics/projects"

describe("projectProfit", () => {
  const invoices: InvoiceForProfit[] = [
    { status: "paid", total_satang: 535_000, vat_satang: 35_000 },
    { status: "sent", total_satang: 300_000, vat_satang: 0 },
    { status: "draft", total_satang: 100_000, vat_satang: 0 },
    { status: "cancelled", total_satang: 200_000, vat_satang: 0 },
  ]
  const costs: CostForProfit[] = [
    { amount_satang: 200_000, input_vat_satang: 0 },
    { amount_satang: 100_000, input_vat_satang: 0 },
  ]

  it("computes revenue, cost, profit, and margin", () => {
    const r = projectProfit(invoices, costs)
    expect(r.revenueSatang).toBe(800_000) // paid + sent before VAT (draft/cancelled excluded)
    expect(r.costSatang).toBe(300_000)
    expect(r.profitSatang).toBe(500_000)
    expect(r.marginPct).toBeCloseTo(62.5, 5)
  })

  it("deducts recoverable VAT including credits while keeping labour intact", () => {
    const costs = [
      { amount_satang: 107_000, input_vat_satang: 7_000 },
      { amount_satang: -21_400, input_vat_satang: -1_400 },
    ]
    const registered = projectProfit(invoices, costs, 10_000, true)
    expect(registered.costSatang).toBe(90_000)
    expect(registered.profitSatang).toBe(710_000)
    expect(projectProfit(invoices, costs, 10_000, false).costSatang).toBe(95_600)
    expect(projectProfit(invoices, costs, 10_000).costSatang).toBe(95_600)
  })

  it("handles zero revenue without dividing by zero", () => {
    const r = projectProfit([], [{ amount_satang: 50_000, input_vat_satang: 0 }])
    expect(r.revenueSatang).toBe(0)
    expect(r.costSatang).toBe(50_000)
    expect(r.profitSatang).toBe(-50_000)
    expect(r.marginPct).toBe(0)
  })

  it("counts revenue before withholding, which the customer pays to the revenue department", () => {
    const invoice = { status: "sent" as const, total_satang: 100_000, vat_satang: 0, amount_satang: 97_000 }
    const r = projectProfit([invoice], [{ amount_satang: 50_000, input_vat_satang: 0 }])
    expect(r.profitSatang).toBe(50_000)
  })
})
