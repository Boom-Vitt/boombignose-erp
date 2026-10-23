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
    { amount_satang: 200_000 },
    { amount_satang: 100_000 },
  ]

  it("computes revenue, cost, profit, and margin", () => {
    const r = projectProfit(invoices, costs)
    expect(r.revenueSatang).toBe(800_000) // paid + sent before VAT (draft/cancelled excluded)
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

  it("counts revenue before withholding, which the customer pays to the revenue department", () => {
    const invoice = { status: "sent" as const, total_satang: 100_000, vat_satang: 0, amount_satang: 97_000 }
    const r = projectProfit([invoice], [{ amount_satang: 50_000 }])
    expect(r.profitSatang).toBe(50_000)
  })
})

it("subtracts issued credit-note bases from project revenue without changing costs", () => {
  expect(projectProfit([{ status: "paid", total_satang: 10700, vat_satang: 700 }], [{ amount_satang: 2000 }], 1000, 4000)).toMatchObject({ revenueSatang: 6000, costSatang: 3000, profitSatang: 3000 })
})
