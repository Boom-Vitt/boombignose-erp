import { describe, expect, it } from "vitest"

import { PAGE_ROWS, readAll, readAllOrThrow } from "./read-all"

const table = Array.from({ length: 2 * PAGE_ROWS + 1 }, (_, i) => i)
const page = (from: number, to: number) => Promise.resolve({ data: table.slice(from, to + 1), error: null })

describe("readAll", () => {
  it("reads past the row cap until a short page", async () => {
    expect((await readAll(page)).data).toEqual(table)
  })

  it("stops on an exactly full last page after one empty read", async () => {
    const full = table.slice(0, PAGE_ROWS)
    const calls: number[] = []
    const { data } = await readAll((from, to) => {
      calls.push(from)
      return Promise.resolve({ data: full.slice(from, to + 1), error: null })
    })
    expect(data).toEqual(full)
    expect(calls).toEqual([0, PAGE_ROWS])
  })

  it("returns no rows when any page fails, never a partial list", async () => {
    const error = new Error("boom")
    const { data, error: got } = await readAll((from, to) =>
      Promise.resolve(from === 0 ? { data: table.slice(from, to + 1), error: null } : { data: null, error })
    )
    expect(data).toBeNull()
    expect(got).toBe(error)
  })
})

describe("readAll de-duplication", () => {
  it("keeps one copy of a row repeated across pages", async () => {
    const pages = [Array.from({ length: PAGE_ROWS }, (_, i) => ({ id: String(i) })), [{ id: "999" }, { id: "1000" }]]
    const { data } = await readAll((from) => Promise.resolve({ data: pages[from / PAGE_ROWS], error: null }))
    expect(data?.map((row) => row.id).slice(-2)).toEqual(["999", "1000"])
    expect(data).toHaveLength(PAGE_ROWS + 1)
  })
})

describe("readAllOrThrow", () => {
  it("returns every row past the row cap", async () => {
    expect(await readAllOrThrow(page)).toEqual(table)
  })

  it("throws the failed page's message instead of returning a partial list", async () => {
    await expect(
      readAllOrThrow((from, to) =>
        Promise.resolve(from === 0 ? { data: table.slice(from, to + 1), error: null } : { data: null, error: { message: "Unavailable" } })
      )
    ).rejects.toThrow("Unavailable")
  })
})
