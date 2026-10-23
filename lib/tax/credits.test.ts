import { describe, expect, it } from "vitest"
import { creditTax } from "./credits"

describe("credit tax residuals", () => {
  it("makes split credits add back to the original mixed-rate VAT and WHT", () => {
    const original = [{ rateBps: 0, enteredSatang: 10005, vatSatang: 0 }, { rateBps: 700, enteredSatang: 10005, vatSatang: 700 }]
    const first = creditTax(original, [0, 0], [5002, 5002], false, 300)
    const last = creditTax(original, [5002, 5002], [10005, 10005], false, 300)
    expect(first.vatSatang + last.vatSatang).toBe(700)
    expect(first.whtSatang + last.whtSatang).toBe(600)
    expect(first.amountDueSatang + last.amountDueSatang).toBe(20110)
  })
  it("handles inclusive prices without refunding VAT twice", () => {
    const original = [{ rateBps: 700, enteredSatang: 10700, vatSatang: 700 }]
    expect(creditTax(original, [0], [10700], true, 300)).toMatchObject({ baseSatang: 10000, vatSatang: 700, whtSatang: 300, amountDueSatang: 10400 })
  })
  it("refuses over-crediting and unsafe money", () => {
    expect(() => creditTax([{ rateBps: 0, enteredSatang: 10, vatSatang: 0 }], [0], [11], false, 0)).toThrow()
    expect(() => creditTax([{ rateBps: 0, enteredSatang: 10, vatSatang: 0 }], [5], [4], false, 0)).toThrow()
  })
  it("credits residual rounding instead of creating an extra satang", () => {
    const original = [{ rateBps: 7000, enteredSatang: 2, vatSatang: 1 }]
    const first = creditTax(original, [0], [1], false, 0)
    const last = creditTax(original, [1], [2], false, 0)
    expect(first.vatSatang + last.vatSatang).toBe(1)
  })
})
