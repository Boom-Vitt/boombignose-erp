import { expect, it } from "vitest"
import { allPurchasingRows } from "./pagination"
it("reads beyond the API row cap before deriving a balance", async () => {
  const data = Array.from({ length: 2001 }, (_, id) => ({ id, amount: 1 }))
  const rows = await allPurchasingRows(async (from, to) => ({ data: data.slice(from, to + 1), error: null }))
  expect(rows.reduce((total, row) => total + row.amount, 0)).toBe(2001)
})
it("rejects a failed page rather than returning an incomplete total", async () => {
  await expect(allPurchasingRows(async from => from === 0 ? { data: Array.from({ length: 1000 }, () => 1), error: null } : { data: null, error: { message: "Unavailable" } })).rejects.toThrow("Unavailable")
})
