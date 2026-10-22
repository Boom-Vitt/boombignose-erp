import { describe, expect, it } from "vitest"
import { MOVE_SIGNS, replenishmentGroups, signedQuantity, stockBalance } from "./math"

describe("inventory quantities and cost", () => {
  it("derives every sign from kind and rejects invalid quantities", () => {
    for (const [kind, sign] of Object.entries(MOVE_SIGNS)) expect(signedQuantity(kind as keyof typeof MOVE_SIGNS, 1.125)).toBe(sign * 1.125)
    for (const quantity of [0, -1, NaN, Infinity, 0.0001]) expect(() => signedQuantity("receipt", quantity)).toThrow()
  })
  it("retains moving average on delivery and weights later receipts against remaining stock", () => {
    expect(stockBalance([
      { kind: "receipt", quantity: 10, unit_cost_satang: 100 },
      { kind: "delivery", quantity: 6, unit_cost_satang: 999 },
      { kind: "receipt", quantity: 6, unit_cost_satang: 200 },
    ])).toEqual({ quantity: 10, average_cost_satang: 160, value_satang: 1600 })
  })
  it("keeps fractional quantity math stable and rounds satang only at the edge", () => {
    expect(stockBalance([
      { kind: "receipt", quantity: 0.1, unit_cost_satang: 101 },
      { kind: "receipt", quantity: 0.2, unit_cost_satang: 102 },
      { kind: "adjustment_out", quantity: 0.1, unit_cost_satang: 0 },
    ])).toEqual({ quantity: 0.2, average_cost_satang: 102, value_satang: 20 })
  })
  it("resets cost at zero and after an allowed negative balance", () => {
    expect(stockBalance([{ kind: "delivery", quantity: 1, unit_cost_satang: 0 }, { kind: "receipt", quantity: 3, unit_cost_satang: 500 }])).toEqual({ quantity: 2, average_cost_satang: 500, value_satang: 1000 })
    expect(stockBalance([{ kind: "receipt", quantity: 1, unit_cost_satang: 100 }, { kind: "delivery", quantity: 1, unit_cost_satang: 100 }])).toEqual({ quantity: 0, average_cost_satang: 0, value_satang: 0 })
    expect(() => stockBalance([{ kind: "receipt", quantity: 2, unit_cost_satang: Number.MAX_SAFE_INTEGER }])).toThrow()
  })
  it("physical counts preserve the unrounded receipt-derived average", () => {
    expect(stockBalance([
      { kind: "receipt", quantity: 1, unit_cost_satang: 100 },
      { kind: "receipt", quantity: 2, unit_cost_satang: 101 },
      { kind: "adjustment_in", quantity: 97, unit_cost_satang: 101 },
    ])).toEqual({ quantity: 100, average_cost_satang: 101, value_satang: 10067 })
  })
  it("rounds exact half-satang values like PostgreSQL numeric", () => {
    expect(stockBalance([
      { kind: "receipt", quantity: 0.001, unit_cost_satang: 4 },
      { kind: "receipt", quantity: 0.008, unit_cost_satang: 62 },
    ])).toEqual({ quantity: 0.009, average_cost_satang: 56, value_satang: 1 })
    expect(stockBalance([{ kind: "receipt", quantity: 1, unit_cost_satang: 1 }, { kind: "delivery", quantity: 1.5, unit_cost_satang: 1 }]).value_satang).toBe(-1)
  })
})

it("groups only below-minimum products by vendor and keeps unconfigured products visible", () => {
  const rows = [
    { id: "a", name: "A", quantity: 0, reorder_min: 1, reorder_qty: 5, default_vendor_id: "v1" },
    { id: "b", name: "B", quantity: 1, reorder_min: 1, reorder_qty: 5, default_vendor_id: "v1" },
    { id: "c", name: "C", quantity: -1, reorder_min: 0, reorder_qty: 0, default_vendor_id: null },
    { id: "d", name: "D", quantity: 1, reorder_min: 2, reorder_qty: 3, default_vendor_id: "v1" },
  ]
  expect(replenishmentGroups(rows)).toEqual([{ vendorId: "v1", products: [rows[0], rows[3]] }, { vendorId: null, products: [rows[2]] }])
})
