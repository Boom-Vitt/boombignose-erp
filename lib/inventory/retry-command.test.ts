import { expect, it } from "vitest"
import { prepareCountCommand } from "./retry-command"

const first = "b8400000-0000-4000-8000-000000000001"
const next = "b8400000-0000-4000-8000-000000000002"
const details = { product_id: "b8400000-0000-4000-8000-000000000030", warehouse_id: "b8400000-0000-4000-8000-000000000020", quantity: 8, reason: "Physical count" }
function storage() {
  const rows = new Map<string, string>()
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}

it("recovers a committed count after reload without erasing an intervening receipt", () => {
  const store = storage()
  const recorded = new Set<string>()
  let onHand = 10
  function post(command: ReturnType<typeof prepareCountCommand>) {
    if (!recorded.has(command.key)) { onHand = command.quantity; recorded.add(command.key) }
  }
  post(prepareCountCommand(store, "org/user", details, () => first))
  onHand += 2
  const reloaded = prepareCountCommand(store, "org/user", details, () => next)
  expect(reloaded.key).toBe(first)
  post(reloaded)
  expect(onHand).toBe(10)
})

it("refuses replacing a pending payload and isolates recovery by workspace and user", () => {
  const store = storage()
  prepareCountCommand(store, "org/user", details, () => first)
  expect(() => prepareCountCommand(store, "org/user", { ...details, quantity: 7 }, () => next)).toThrow("saved count")
  expect(prepareCountCommand(store, "other-org/user", details, () => next).key).toBe(next)
})

it("does not post when browser storage cannot persist a recoverable command", () => {
  const blocked = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") }, removeItem: () => {} }
  expect(() => prepareCountCommand(blocked, "org/user", details, () => first)).toThrow("Browser storage")
  expect(() => prepareCountCommand(null, "org/user", details, () => first)).toThrow("Browser storage")
})
