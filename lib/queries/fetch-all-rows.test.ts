import { describe, expect, it } from "vitest"
import { fetchAllRows } from "./fetch-all-rows"

function capped(total: number, ranges: [number, number][] = []) {
  return () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to])
      return { data: Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => ({ id: String(from + i) })), error: null }
    },
  })
}

describe("fetchAllRows", () => {
  it("pages past the 1,000-row cap until a short page", async () => {
    const ranges: [number, number][] = []
    const rows = await fetchAllRows(capped(2001, ranges))
    expect(rows).toHaveLength(2001)
    expect(rows.at(-1)).toEqual({ id: "2000" })
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
  it("stops after an exact multiple with one empty page", async () => {
    expect(await fetchAllRows(capped(1000))).toHaveLength(1000)
    expect(await fetchAllRows(capped(0))).toEqual([])
  })
  it("keeps one copy of a row repeated across pages", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })), [{ id: "999" }, { id: "1000" }]]
    const rows = await fetchAllRows(() => ({ range: async (from: number) => ({ data: pages[from / 1000], error: null }) }))
    expect(rows.map((row) => row.id).slice(-2)).toEqual(["999", "1000"])
    expect(rows).toHaveLength(1001)
  })
  it("throws instead of returning a partial list", async () => {
    const failing = () => ({ range: async () => ({ data: null as { id: string }[] | null, error: new Error("boom") }) })
    await expect(fetchAllRows(failing)).rejects.toThrow("boom")
  })
})
