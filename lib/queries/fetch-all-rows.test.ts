import { describe, expect, it } from "vitest"
import { fetchAllRows } from "./fetch-all-rows"

function capped(total: number, ranges: [number, number][] = []) {
  return () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to])
      return { data: Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => from + i), error: null }
    },
  })
}

describe("fetchAllRows", () => {
  it("pages past the 1,000-row cap until a short page", async () => {
    const ranges: [number, number][] = []
    const rows = await fetchAllRows(capped(2001, ranges))
    expect(rows).toHaveLength(2001)
    expect(rows.at(-1)).toBe(2000)
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
  it("stops after an exact multiple with one empty page", async () => {
    expect(await fetchAllRows(capped(1000))).toHaveLength(1000)
    expect(await fetchAllRows(capped(0))).toEqual([])
  })
  it("throws instead of returning a partial list", async () => {
    const failing = () => ({ range: async () => ({ data: null, error: new Error("boom") }) })
    await expect(fetchAllRows(failing)).rejects.toThrow("boom")
  })
})
