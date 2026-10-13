import { describe, expect, it } from "vitest"
import { quoteIsEditable, quoteTransitionError, serviceAmountSatang, serviceLineAmount, quoteConversionKey, serviceAmountBaht } from "./service"

describe("service quote lifecycle", () => {
  it("allows draft to sent and sent to accepted or declined", () => {
    expect(quoteTransitionError("draft", "sent", null, "2026-10-13")).toBeNull()
    expect(quoteTransitionError("sent", "accepted", "2026-10-13", "2026-10-13")).toBeNull()
    expect(quoteTransitionError("sent", "declined", null, "2026-10-13")).toBeNull()
  })
  it("rejects skipped, reversed and converted transitions", () => {
    expect(quoteTransitionError("draft", "accepted", null, "2026-10-13")).toBeTruthy()
    expect(quoteTransitionError("accepted", "draft", null, "2026-10-13")).toBeTruthy()
    expect(quoteTransitionError("accepted", "converted", null, "2026-10-13")).toBeTruthy()
    expect(quoteTransitionError("converted", "sent", null, "2026-10-13")).toBeTruthy()
  })
  it("permits same-status retries but rejects accepting an expired quote", () => {
    expect(quoteTransitionError("sent", "sent", null, "2026-10-13")).toBeNull()
    expect(quoteTransitionError("sent", "accepted", "2026-10-12", "2026-10-13")).toBeTruthy()
  })
  it("freezes accepted and terminal quote content", () => {
    expect(quoteIsEditable("draft")).toBe(true)
    expect(quoteIsEditable("sent")).toBe(true)
    for (const status of ["accepted", "converted", "expired", "declined"] as const) {
      expect(quoteIsEditable(status)).toBe(false)
    }
  })
})

describe("quote conversion browser key", () => {
  it("keeps the request identity through retries and remounts", () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const key = "00000000-0000-4000-8000-000000000001"
    expect(quoteConversionKey(storage, "org-a:quote-a", () => key)).toBe(key)
    expect(quoteConversionKey(storage, "org-a:quote-a", () => { throw new Error("Should reuse key") })).toBe(key)
    expect(quoteConversionKey(storage, "org-b:quote-b", () => "00000000-0000-4000-8000-000000000002")).not.toBe(key)
  })
  it("ignores corrupt stored keys and tolerates blocked browser storage", () => {
    const key = "00000000-0000-4000-8000-000000000001"
    expect(quoteConversionKey({ getItem: () => "corrupt", setItem: () => {} }, "org:quote", () => key)).toBe(key)
    expect(quoteConversionKey({ getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") } }, "org:quote", () => key)).toBe(key)
  })
})

describe("service money inputs", () => {
  it("parses THB exactly, including zero and the safe boundary", () => {
    expect(serviceAmountSatang("1.01")).toBe(101)
    expect(serviceAmountSatang(0)).toBe(0)
    expect(serviceAmountSatang("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER)
  })
  it("preserves every satang when prefilling a form", () => {
    expect(serviceAmountBaht(101)).toBe("1.01")
    expect(serviceAmountBaht(0)).toBe("0.00")
    expect(serviceAmountBaht(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91")
    expect(() => serviceAmountBaht(1.01)).toThrow()
  })
  it.each(["-1", "1.001", "NaN", "Infinity", "1e3", "90071992547409.92"])("rejects invalid price %s", (value) => {
    expect(() => serviceAmountSatang(value)).toThrow()
  })
  it("rounds exact decimal quantities once to satang", () => {
    // 1.005 * 100 = 100.5, which binary multiplication can round down.
    expect(serviceLineAmount("1.005", 100)).toBe(101)
    expect(serviceLineAmount("0.125", 101)).toBe(13)
    expect(serviceLineAmount("999999999.999", 0)).toBe(0)
  })
  it.each(["0", "-1", "1.0001", "1000000000", "1e3"])("rejects quantities outside numeric(12,3): %s", (value) => {
    expect(() => serviceLineAmount(value, 100)).toThrow()
  })
  it("rejects unsafe extended amounts", () => {
    expect(() => serviceLineAmount("2", Number.MAX_SAFE_INTEGER)).toThrow()
  })
})
