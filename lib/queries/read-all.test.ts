import { expect, it } from "vitest"
import { readAll } from "./read-all"

it("reads beyond the API cap, including an exact page boundary", async () => {
  for (const length of [0, 500, 1001, 1500]) {
    const rows = Array.from({ length }, (_, id) => ({ id }))
    const result = await readAll(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }))
    expect(result).toEqual({ data: rows, error: null })
  }
})

it("discards incomplete financial data when a later page fails", async () => {
  const result = await readAll(async from => from === 0 ? { data: Array(500).fill(1), error: null } : { data: null, error: { message: "offline" } })
  expect(result).toEqual({ data: [], error: { message: "offline" } })
})
