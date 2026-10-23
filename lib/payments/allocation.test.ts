import { expect, it } from "vitest"
import { allocationRemainder } from "./allocation"

it("keeps excess cash as credit without rounding", () => {
  expect(allocationRemainder(25001, [{ invoiceId: "a", amountSatang: 10000 }, { invoiceId: "b", amountSatang: 10000 }])).toBe(5001)
  expect(allocationRemainder(Number.MAX_SAFE_INTEGER, [{ invoiceId: "a", amountSatang: Number.MAX_SAFE_INTEGER }])).toBe(0)
})
it("rejects duplicate, unsafe, negative and excessive allocations", () => {
  for (const amounts of [[10, 1], [-1], [1.1], [Number.MAX_SAFE_INTEGER + 1]]) {
    expect(() => allocationRemainder(10, amounts.map((amountSatang, i) => ({ invoiceId: String(i), amountSatang })))).toThrow()
  }
  expect(() => allocationRemainder(10, [{ invoiceId: "a", amountSatang: 1 }, { invoiceId: "a", amountSatang: 1 }])).toThrow()
})
