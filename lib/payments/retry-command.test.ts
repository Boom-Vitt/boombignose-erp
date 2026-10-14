import { expect, it } from "vitest"
import { paymentCommandKey } from "./retry-command"

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

it("ignores corrupt browser state and retains a key in memory if storage is unavailable", () => {
  const key = "00000000-0000-4000-8000-000000000001"
  const store = { getItem: () => "broken-json", setItem: () => { throw new Error("blocked") } }
  expect(paymentCommandKey(store, "org/invoice/report", ["1", "ref"], () => key)).toBe(key)
})
