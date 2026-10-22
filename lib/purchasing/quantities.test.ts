import { describe, expect, it } from "vitest"
import { applyReceipt, billAmount, purchaseTotal, type PurchaseLine } from "./quantities"

const lines: PurchaseLine[] = [
  { id: "a", quantity: 2.5, unit_cost_satang: 101, received_quantity: 0, billed_quantity: 0 },
  { id: "b", quantity: 3, unit_cost_satang: 1000, received_quantity: 1, billed_quantity: 0 },
]
describe("purchase satang totals", () => {
  it("rounds each decimal line exactly like PostgreSQL", () => {
    expect(purchaseTotal(lines)).toBe(3253)
    expect(purchaseTotal([{ quantity: 1.005, unit_cost_satang: 100 }])).toBe(101)
  })
  it("rejects unsafe totals and invalid quantities", () => {
    expect(() => purchaseTotal([{ quantity: 2, unit_cost_satang: Number.MAX_SAFE_INTEGER }])).toThrow()
    expect(() => purchaseTotal([{ quantity: 1.0001, unit_cost_satang: 100 }])).toThrow()
    expect(() => purchaseTotal([{ quantity: 0, unit_cost_satang: 100 }])).toThrow()
    expect(() => purchaseTotal([{ quantity: 1, unit_cost_satang: -1 }])).toThrow()
    expect(() => purchaseTotal([{ quantity: 1, unit_cost_satang: Number.MAX_SAFE_INTEGER }, { quantity: 1, unit_cost_satang: 1 }])).toThrow()
  })
})
describe("cumulative partial receipts", () => {
  it("preserves other lines, accepts zero, and is idempotent", () => {
    const receipt = [{ id: "a", received_quantity: 1.125 }]
    expect(applyReceipt(lines, receipt)).toEqual([{ id: "a", received_quantity: 1.125 }, { id: "b", received_quantity: 1 }])
    const received = lines.map((line, i) => ({ ...line, ...applyReceipt(lines, receipt)[i] }))
    expect(applyReceipt(received, receipt)).toEqual(applyReceipt(lines, receipt))
    expect(lines[0].received_quantity).toBe(0)
    expect(applyReceipt(lines, [{ id: "a", received_quantity: 0 }])[0].received_quantity).toBe(0)
  })
  it("rejects overreceipt, backward counts, unknown and duplicate lines", () => {
    for (const receipt of [[{ id: "a", received_quantity: 2.501 }], [{ id: "b", received_quantity: 0 }], [{ id: "x", received_quantity: 1 }], [{ id: "a", received_quantity: 1 }, { id: "a", received_quantity: 1 }], [{ id: "a", received_quantity: NaN }], [{ id: "a", received_quantity: 0.0001 }]]) {
      expect(() => applyReceipt(lines, receipt)).toThrow()
    }
  })
})
describe("vendor bill amount", () => {
  it("bills only received quantities not previously billed", () => {
    expect(billAmount(lines)).toBe(1000)
    expect(billAmount([{ unit_cost_satang: 101, received_quantity: 2.5, billed_quantity: 1 }])).toBe(152)
    expect(billAmount([{ unit_cost_satang: 101, received_quantity: 2.5, billed_quantity: 2.5 }])).toBe(0)
  })
  it("retains one rounded satang across multiple receipts", () => {
    const first = billAmount([{ unit_cost_satang: 1, received_quantity: 0.5, billed_quantity: 0 }])
    const second = billAmount([{ unit_cost_satang: 1, received_quantity: 1, billed_quantity: 0.5 }])
    expect(first + second).toBe(1)
    expect(() => billAmount([{ unit_cost_satang: 1, received_quantity: 1, billed_quantity: 2 }])).toThrow()
  })
})
