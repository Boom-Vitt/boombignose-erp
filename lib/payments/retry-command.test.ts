import { expect, it } from "vitest"
import { paymentCommandKey, financialCommandKey, completePaymentCommand } from "./retry-command"

it("recovers a command key after reload and changes it only when details change", () => {
  const values = new Map<string, string>()
  const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
  const first = "00000000-0000-4000-8000-000000000001"
  const next = "00000000-0000-4000-8000-000000000002"
  expect(paymentCommandKey(store, "org/invoice/report", ["1.01", "bank-ref"], () => first)).toBe(first)
  expect(paymentCommandKey(store, "org/invoice/report", ["1.01", "bank-ref"], () => next)).toBe(first)
  expect(paymentCommandKey(store, "org/invoice/report", ["1.02", "bank-ref"], () => next)).toBe(next)
  expect(paymentCommandKey(store, "other-org/invoice/report", ["1.01", "bank-ref"], () => next)).toBe(next)
})

it("retains uncertain commands and retires only acknowledged commands", () => {
  const values = new Map<string, string>()
  const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
  const first = "00000000-0000-4000-8000-000000000001", next = "00000000-0000-4000-8000-000000000002"
  expect(financialCommandKey(store, "credit", ["10", "return"], () => first)).toBe(first)
  expect(financialCommandKey(store, "credit", ["10", "return"], () => next)).toBe(first)
  completePaymentCommand(store, "credit", first)
  expect(financialCommandKey(store, "credit", ["10", "return"], () => next)).toBe(next)
  completePaymentCommand(store, "credit", first)
  expect(financialCommandKey(store, "credit", ["10", "return"], () => first)).toBe(next)
})

it("blocks financial commands if a reload could lose retry identity", () => {
  const store = { getItem: () => null, setItem: () => {} }
  expect(() => financialCommandKey(store, "credit", [], () => "00000000-0000-4000-8000-000000000001")).toThrow("Browser storage")
})

it("ignores corrupt browser state and retains a key in memory if storage is unavailable", () => {
  const key = "00000000-0000-4000-8000-000000000001"
  const store = { getItem: () => "broken-json", setItem: () => { throw new Error("blocked") } }
  expect(paymentCommandKey(store, "org/invoice/report", ["1", "ref"], () => key)).toBe(key)
})
