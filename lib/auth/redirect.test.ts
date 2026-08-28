import { describe, expect, it } from "vitest"

import { safeRedirectPath } from "@/lib/auth/redirect"

describe("safeRedirectPath", () => {
  it("keeps internal relative paths", () => {
    expect(safeRedirectPath("/clients?view=active")).toBe("/clients?view=active")
  })

  it("rejects external and protocol-relative values", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard")
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard")
    expect(safeRedirectPath(undefined)).toBe("/dashboard")
  })
})
