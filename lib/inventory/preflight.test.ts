import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

it("runs the same snapshot-only report in the legacy-schema pgTAP regression", () => {
  const report = readFileSync("supabase/preflight/customer_return_valuation_report.sql", "utf8")
  expect(report).not.toContain("stock_value_satang")
  expect(readFileSync("supabase/tests/inventory_extras_preflight.sql", "utf8")).toContain(report)
  expect(readFileSync("supabase/preflight/customer_return_valuation_check.sql", "utf8")).toContain("raise exception")
})
