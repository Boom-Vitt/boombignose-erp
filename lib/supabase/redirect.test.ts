import { expect, it } from "vitest"

import { withReturnPath } from "@/lib/supabase/redirect"

it("carries a local destination to the next auth step", () => {
  expect(withReturnPath("/signup", "/invite/abc")).toBe("/signup?redirect=%2Finvite%2Fabc")
})

it("leaves the path alone without a destination", () => {
  expect(withReturnPath("/setup-2fa", null)).toBe("/setup-2fa")
})

it("never forwards an external destination", () => {
  expect(withReturnPath("/signup", "//evil.example.test")).toBe("/signup?redirect=%2Fdashboard")
})
