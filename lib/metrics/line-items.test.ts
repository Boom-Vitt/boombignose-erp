import { describe, it, expect } from "vitest"

import {
  lineAmountSatang,
  withLineAmount,
  subtotalSatang,
  documentTotalSatang,
} from "./line-items"

describe("lineAmountSatang", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineAmountSatang(2, 50000)).toBe(100000)
  })

  it("rounds fractional quantities to the nearest satang", () => {
    // 1.5 h × ฿333.33 = ฿499.995 → 49999.5 satang → 50000
    expect(lineAmountSatang(1.5, 33333)).toBe(50000)
  })

  it("returns 0 for non-finite input", () => {
    expect(lineAmountSatang(NaN, 1000)).toBe(0)
    expect(lineAmountSatang(1, Infinity)).toBe(0)
  })
})

describe("withLineAmount", () => {
  it("attaches the computed amount", () => {
    expect(withLineAmount({ quantity: 3, unit_price_satang: 10000 })).toEqual({
      quantity: 3,
      unit_price_satang: 10000,
      amount_satang: 30000,
    })
  })
})

describe("subtotalSatang", () => {
  it("sums raw inputs", () => {
    expect(
      subtotalSatang([
        { quantity: 2, unit_price_satang: 10000 },
        { quantity: 1, unit_price_satang: 5000 },
      ])
    ).toBe(25000)
  })

  it("prefers a precomputed amount_satang when present", () => {
    expect(subtotalSatang([{ amount_satang: 12345 }, { amount_satang: 55 }])).toBe(
      12400
    )
  })

  it("is 0 for an empty document", () => {
    expect(subtotalSatang([])).toBe(0)
  })
})

describe("documentTotalSatang", () => {
  it("subtracts the discount", () => {
    expect(documentTotalSatang(100000, 15000)).toBe(85000)
  })

  it("floors at 0 when discount exceeds subtotal", () => {
    expect(documentTotalSatang(10000, 25000)).toBe(0)
  })

  it("ignores a negative discount", () => {
    expect(documentTotalSatang(10000, -5000)).toBe(10000)
  })

  it("defaults discount to 0", () => {
    expect(documentTotalSatang(10000)).toBe(10000)
  })
})
