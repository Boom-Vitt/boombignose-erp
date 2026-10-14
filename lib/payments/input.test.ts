import { expect, it } from "vitest"
import { paymentAmount } from "./input"

it("parses decimal THB exactly and rejects unsafe or fractional satang", () => {
  expect(paymentAmount("1.01")).toBe(101)
  expect(paymentAmount("100000.99")).toBe(10000099)
  for (const amount of ["0", "-1", "NaN", "Infinity", "1.001", "90071992547410.00", "1e2", ""]) {
    expect(() => paymentAmount(amount)).toThrow()
  }
})
