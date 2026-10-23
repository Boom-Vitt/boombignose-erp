import { expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { readReplenishmentPlan } from "./replenishment"

it("includes a distinct vendor after 1,000 plan lines and fails a broken later page", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ product_id: String(i), vendor_id: i === 1000 ? "last-vendor" : "first-vendor" }))
  const ranges: number[] = []
  let fail = false
  const db = { rpc: () => { const query = { order: () => query, range: async (from: number, to: number) => {
    ranges.push(from)
    return { data: fail && from === 1000 ? null : rows.slice(from, to + 1), error: fail && from === 1000 ? { message: "Second page unavailable" } : null }
  } }; return query } } as unknown as SupabaseClient<Database>
  const plan = await readReplenishmentPlan(db, "org", "2026-10-23")
  expect(plan).toHaveLength(1001)
  expect(plan.at(-1)?.vendor_id).toBe("last-vendor")
  expect(ranges).toEqual([0, 1000])
  fail = true
  await expect(readReplenishmentPlan(db, "org", "2026-10-23")).rejects.toThrow("Second page unavailable")
})
