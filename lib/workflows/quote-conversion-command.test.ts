import { describe, expect, it, vi } from "vitest"

function storage() {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const orgId = "a0000000-0000-0000-0000-000000000001"
const quoteId = "70000000-0000-0000-0000-000000000001"
const lineId = "71000000-0000-0000-0000-000000000001"
const firstKey = "11111111-1111-4111-8111-111111111111"
const secondKey = "22222222-2222-4222-8222-222222222222"
const storageKey = `erp.quote.request:${orgId}:${quoteId}`

async function commands() {
  vi.resetModules()
  return import("./quote-conversion-command")
}

describe("pending quote conversion command", () => {
  it("recovers key and exact payload after a full module reload without relying on invoice progress", async () => {
    const store = storage()
    const first = await commands()
    const original = first.beginQuoteConversionCommand(store, orgId, quoteId, { depositBps: 2500 }, () => firstKey)
    const reloaded = await commands()
    expect(reloaded.readQuoteConversionCommand(store, orgId, quoteId)).toEqual(original)
    expect(reloaded.beginQuoteConversionCommand(store, orgId, quoteId, { depositBps: 5000 }, () => secondKey)).toEqual(original)
    expect(store.data.size).toBe(1)
  })

  it("snapshots selected quantities so later input mutation cannot alter the saved command", async () => {
    const store = storage()
    const helper = await commands()
    const request = { lines: [{ quote_item_id: lineId, quantity: "1.250" }] }
    const original = helper.beginQuoteConversionCommand(store, orgId, quoteId, request, () => firstKey)
    request.lines[0].quantity = "2"
    expect(helper.readQuoteConversionCommand(store, orgId, quoteId)).toEqual(original)
    expect(original.request.lines).toEqual([{ quote_item_id: lineId, quantity: "1.250" }])
  })

  it("separates organizations and quotes and ignores stale acknowledgements", async () => {
    const helper = await commands()
    const store = storage()
    helper.beginQuoteConversionCommand(store, orgId, quoteId, {}, () => firstKey)
    helper.acknowledgeQuoteConversionCommand(store, orgId, quoteId, secondKey)
    expect(helper.readQuoteConversionCommand(store, orgId, quoteId)?.key).toBe(firstKey)
    expect(helper.readQuoteConversionCommand(store, quoteId, quoteId)).toBeNull()
    expect(helper.readQuoteConversionCommand(store, orgId, orgId)).toBeNull()
    helper.acknowledgeQuoteConversionCommand(store, orgId, quoteId, firstKey)
    expect(helper.readQuoteConversionCommand(store, orgId, quoteId)).toBeNull()
    expect(store.data.size).toBe(0)
    expect(helper.beginQuoteConversionCommand(store, orgId, quoteId, {}, () => secondKey).key).toBe(secondKey)
  })

  it.each(["getItem", "setItem"] as const)("blocks new commands through module reload when storage %s throws", async (method) => {
    const helper = await commands()
    const store = storage()
    store[method] = () => { throw new Error("Blocked") }
    expect(() => helper.beginQuoteConversionCommand(store, orgId, quoteId, { depositSatang: 10001 }, () => firstKey)).toThrow()
    const reloaded = await commands()
    expect(() => reloaded.beginQuoteConversionCommand(store, orgId, quoteId, { depositSatang: 20000 }, () => secondKey)).toThrow()
  })

  it("blocks a new command without browser storage", async () => {
    const helper = await commands()
    expect(() => helper.beginQuoteConversionCommand(null, orgId, quoteId, {}, () => firstKey)).toThrow()
  })

  it.each([
    "{", JSON.stringify({ orgId, quoteId, key: "invalid", request: {} }),
    JSON.stringify({ orgId, quoteId: orgId, key: firstKey, request: {} }),
    JSON.stringify({ orgId, quoteId, key: firstKey, request: { depositBps: 2500, depositSatang: 100 } }),
    JSON.stringify({ orgId, quoteId, key: firstKey, request: { lines: [{ quote_item_id: lineId, quantity: "1.0001" }] } }),
    JSON.stringify({ orgId, quoteId, key: firstKey, request: { lines: [{ quote_item_id: lineId, quantity: 1 }, { quote_item_id: lineId, quantity: 2 }] } }),
    JSON.stringify({ orgId, quoteId, key: firstKey, request: { unexpected: 25 } }),
  ])("fails closed for invalid saved content: %s", async (raw) => {
    const helper = await commands()
    const store = storage()
    store.setItem(storageKey, raw)
    expect(() => helper.beginQuoteConversionCommand(store, orgId, quoteId, {}, () => secondKey)).toThrow("saved invoice request is invalid")
    expect(store.getItem(storageKey)).toBe(raw)
  })
})
