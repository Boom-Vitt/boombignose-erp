import { describe, it, expect } from "vitest"

import { can, capabilitiesFor, CAPABILITY_ROLES, type Capability } from "./permissions"

describe("can", () => {
  it("grants owner every capability", () => {
    for (const cap of Object.keys(CAPABILITY_ROLES) as Capability[]) {
      expect(can("owner", cap)).toBe(true)
    }
  })

  it("grants admin the operational capabilities", () => {
    expect(can("admin", "quote:convert")).toBe(true)
    expect(can("admin", "subscription:manage")).toBe(true)
    expect(can("admin", "team:manage")).toBe(true)
  })

  it("denies members every gated capability", () => {
    for (const cap of Object.keys(CAPABILITY_ROLES) as Capability[]) {
      expect(can("member", cap)).toBe(false)
    }
  })
})

describe("capabilitiesFor", () => {
  it("returns all capabilities for owner", () => {
    expect(capabilitiesFor("owner").length).toBe(
      Object.keys(CAPABILITY_ROLES).length
    )
  })

  it("returns none for member", () => {
    expect(capabilitiesFor("member")).toEqual([])
  })
})
