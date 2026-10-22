import { describe, expect, it } from "vitest"
import { calculateTax, WHT_RATES } from "./totals"

const line = (amount_satang: number, tax_rate_bps = 700) => ({ amount_satang, tax_rate_bps })

describe("document tax totals", () => {
  it.each(WHT_RATES)("exclusive VAT and WHT %i bps", wht => {
    expect(calculateTax([line(100000)], 0, false, wht)).toMatchObject({ baseSatang: 100000, vatSatang: 7000, totalSatang: 107000, whtSatang: wht * 10, amountDueSatang: 107000 - wht * 10 })
  })
  it.each(WHT_RATES)("extracts inclusive VAT before WHT %i bps", wht => {
    expect(calculateTax([line(107000)], 0, true, wht)).toMatchObject({ baseSatang: 100000, vatSatang: 7000, totalSatang: 107000, amountDueSatang: 107000 - wht * 10 })
  })
  it("discounts before exclusive VAT and WHT", () => {
    expect(calculateTax([line(100000)], 10000, false, 300)).toMatchObject({ subtotalSatang: 100000, discountSatang: 10000, baseSatang: 90000, vatSatang: 6300, totalSatang: 96300, whtSatang: 2700, amountDueSatang: 93600 })
  })
  it("discounts inclusive prices before extracting VAT", () => {
    expect(calculateTax([line(107000)], 10700, true, 300)).toMatchObject({ baseSatang: 90000, vatSatang: 6300, totalSatang: 96300, whtSatang: 2700 })
  })
  it("handles inclusive mixed rates and exempt amounts before withholding", () => {
    expect(calculateTax([line(107000, 700), line(105000, 500), line(100000, 0)], 31200, true, 300)).toMatchObject({ baseSatang: 270000, vatSatang: 10800, totalSatang: 280800, whtSatang: 8100, amountDueSatang: 272700 })
  })
  it("allocates mixed-rate discounts proportionately with stable ties", () => {
    const result = calculateTax([line(10000, 0), line(10000, 700), line(10000, 1000)], 1)
    expect(result.vatByRate).toEqual([{ rateBps: 0, baseSatang: 9999, vatSatang: 0 }, { rateBps: 700, baseSatang: 10000, vatSatang: 700 }, { rateBps: 1000, baseSatang: 10000, vatSatang: 1000 }])
    expect(calculateTax([line(10000, 1000), line(10000, 700), line(10000, 0)], 1)).toEqual(result)
  })
  it("rounds half up per document rate rather than per line", () => {
    expect(calculateTax([line(5, 1000), line(5, 1000)]).vatSatang).toBe(1)
    expect(calculateTax([line(5, 1000)]).vatSatang).toBe(1)
    expect(calculateTax([line(1, 10000)], 0, true).vatSatang).toBe(1)
    expect(calculateTax([line(50, 0)], 0, false, 100).whtSatang).toBe(1)
  })
  it("handles empty and fully discounted documents", () => {
    expect(calculateTax([]).amountDueSatang).toBe(0)
    expect(calculateTax([line(100)], 100, true, 500).amountDueSatang).toBe(0)
  })
  it("preserves exact invariants over small mixed-rate rounding cases", () => {
    for (const inclusive of [false, true]) for (let a = 0; a < 25; a++) for (let b = 0; b < 25; b++) for (const wht of WHT_RATES) {
      const lines = [line(a), line(b, 1000)]
      const discount = Math.floor((a + b) / 3)
      const result = calculateTax(lines, discount, inclusive, wht)
      expect(result.baseSatang + result.vatSatang).toBe(result.totalSatang)
      expect(result.totalSatang - result.whtSatang).toBe(result.amountDueSatang)
      expect(result.baseSatang + (inclusive ? result.vatSatang : 0)).toBe(a + b - discount)
      expect(calculateTax(lines.reverse(), discount, inclusive, wht)).toEqual(result)
    }
  })
  it("uses exact intermediate arithmetic near safe integer limits", () => {
    expect(calculateTax([line(Number.MAX_SAFE_INTEGER)], 0, true, 500).totalSatang).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => calculateTax([line(Number.MAX_SAFE_INTEGER)])).toThrow("safe satang")
  })
  it("rejects invalid money, discounts and rates", () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => calculateTax([line(value)])).toThrow()
    for (const value of [-1, 0.5, 10001, NaN]) expect(() => calculateTax([line(1, value)])).toThrow()
    expect(() => calculateTax([line(1)], 2)).toThrow("Discount")
    expect(() => calculateTax([line(1)], 0, false, 400)).toThrow("WHT")
  })
})
