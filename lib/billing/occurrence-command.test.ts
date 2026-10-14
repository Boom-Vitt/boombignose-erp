import { describe, expect, it } from "vitest"
import { beginInvoiceRequest, readInvoiceRequest, acknowledgeInvoiceRequest, type RequestStore } from "./occurrence-command"

function storage(): RequestStore {
  const data = new Map<string, string>()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}
const org = "11111111-1111-4111-8111-111111111111"
const sub = "22222222-2222-4222-8222-222222222222"

describe("manual occurrence retry persistence", () => {
  it("resumes the unacknowledged date when refreshed props show the next backlog period", () => {
    const store = storage()
    expect(beginInvoiceRequest(store, org, sub, "2026-07-02").occurrence).toBe("2026-07-02")
    // Recreated UI after reload/status refresh now sees July9 from the DB.
    expect(readInvoiceRequest(store, org, sub)?.occurrence).toBe("2026-07-02")
    expect(beginInvoiceRequest(store, org, sub, "2026-07-09").occurrence).toBe("2026-07-02")
    acknowledgeInvoiceRequest(store, org, sub, "2026-07-02")
    expect(beginInvoiceRequest(store, org, sub, "2026-07-09").occurrence).toBe("2026-07-09")
  })
  it("separates organizations and subscriptions", () => {
    const store = storage()
    beginInvoiceRequest(store, org, sub, "2026-07-02")
    expect(beginInvoiceRequest(store, sub, sub, "2026-07-09").occurrence).toBe("2026-07-09")
    expect(beginInvoiceRequest(store, org, org, "2026-07-16").occurrence).toBe("2026-07-16")
  })
  it("does not let an old acknowledgement clear a newer unresolved command", () => {
    const store = storage()
    beginInvoiceRequest(store, org, sub, "2026-07-09")
    acknowledgeInvoiceRequest(store, org, sub, "2026-07-02")
    expect(readInvoiceRequest(store, org, sub)?.occurrence).toBe("2026-07-09")
  })
  it("fails closed when the browser cannot persist a request", () => {
    const store = storage()
    store.setItem = () => { throw new Error("Storage unavailable") }
    expect(() => beginInvoiceRequest(store, org, sub, "2026-07-02")).toThrow("Storage unavailable")
  })
})
