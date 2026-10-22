import { expect, it } from "vitest"
import { acknowledgeCountCommand, prepareCountCommand, readPendingCount } from "./retry-command"

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

it("keeps the complete pending payload until its matching acknowledgement", () => {
  const store = storage()
  prepareCountCommand(store, "org/user", details, () => first)
  expect(readPendingCount(store, "org/user")).toEqual({ ...details, key: first })
  expect(acknowledgeCountCommand(store, "org/user", next, {})).toBe(false)
  expect(readPendingCount(store, "org/user")?.key).toBe(first)
  expect(acknowledgeCountCommand(store, "org/user", first, {})).toBe(true)
  expect(readPendingCount(store, "org/user")).toBeNull()
  expect(prepareCountCommand(store, "org/user", details, () => next).key).toBe(next)
})

it("ignores malformed stored payloads and handles acknowledgement storage failures", () => {
  const store = storage()
  store.setItem("erp/inventory-count/org/user", "broken-json")
  expect(readPendingCount(store, "org/user")).toBeNull()
  prepareCountCommand(store, "org/user", details, () => first)
  const blocked = { ...store, removeItem: () => { throw new Error("blocked") } }
  expect(acknowledgeCountCommand(blocked, "org/user", first, {})).toBe(false)
  expect(readPendingCount(store, "org/user")?.key).toBe(first)
})

it("retains recovery when a returned RPC error could follow a committed count", () => {
  const store = storage()
  prepareCountCommand(store, "org/user", details, () => first)
  expect(acknowledgeCountCommand(store, "org/user", first, { error: "Fetch failed after commit" })).toBe(false)
  expect(readPendingCount(store, "org/user")?.key).toBe(first)
})
