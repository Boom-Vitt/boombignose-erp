import { expect, it } from "vitest"

import { safeReturnPath, withReturnPath } from "@/lib/supabase/redirect"

it("carries a local destination to the next auth step", () => {
  expect(withReturnPath("/signup", "/invite/abc")).toBe("/signup?redirect=%2Finvite%2Fabc")
})

it("leaves the path alone without a destination", () => {
  expect(withReturnPath("/setup-2fa", null)).toBe("/setup-2fa")
})

it("never forwards an external destination", () => {
  expect(withReturnPath("/signup", "//evil.example.test")).toBe("/signup?redirect=%2Fdashboard")
})

it("keeps a local path with its query and hash", () => {
  expect(safeReturnPath("/deals?stage=won#top")).toBe("/deals?stage=won#top")
})

it.each([null, "", "dashboard", "http:/evil.test", "/%2F%2Fevil.test", "/%5Cevil.test", "/\tevil", "/%", "/%E0%A4%A"])(
  "falls back to the dashboard for an unsafe or malformed destination %j",
  (value) => {
    expect(safeReturnPath(value)).toBe("/dashboard")
  }
)

it.each(["/login", "/login/mfa", "/signup", "/auth/confirm", "/a/../login", "/%2e%2e/login"])(
  "never returns to an auth step %j, which would loop the sign-in",
  (value) => {
    expect(safeReturnPath(value)).toBe("/dashboard")
  }
)

it("only blocks whole auth segments, not routes that share a prefix", () => {
  expect(safeReturnPath("/authz")).toBe("/authz")
})
