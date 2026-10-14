import { expect, it } from "vitest"
import { paymentAmount, moneyInput, invoiceLineAmount } from "./input"

it("parses decimal THB exactly and rejects unsafe or fractional satang", () => {
  expect(paymentAmount("1.01")).toBe(101)
  expect(paymentAmount("100000.99")).toBe(10000099)
  for (const amount of ["0", "-1", "NaN", "Infinity", "1.001", "90071992547410.00", "1e2", ""]) {
    expect(() => paymentAmount(amount)).toThrow()
  }
})

it("keeps exact nonnegative invoice/cost amounts within safe satang bounds", () => {
  expect(moneyInput("0.00")).toBe(0)
  expect(moneyInput("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER)
  expect(moneyInput(" 1.01 ")).toBe(101)
  for (const value of ["1.001", "-0.01", "90071992547409.92", "1e2", ""]) {
    expect(() => moneyInput(value)).toThrow()
  }
})

it("rounds fractional invoice quantities once using exact satang math", () => {
  expect(invoiceLineAmount("1.005", 100)).toBe(101)
  expect(invoiceLineAmount("2.125", 101)).toBe(215)
  for (const quantity of ["0", "-1", "1.0001", "1e2", "1000000000"]) {
    expect(() => invoiceLineAmount(quantity, 100)).toThrow()
  }
  expect(() => invoiceLineAmount("2", Number.MAX_SAFE_INTEGER)).toThrow()
})
