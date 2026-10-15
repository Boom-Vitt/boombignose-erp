import { existsSync } from "node:fs"
import { join } from "node:path"

import { describe, it, expect } from "vitest"

import { ZONES, zoneLink } from "@/lib/campus-zones"

describe("campus zone → 2D route", () => {
  it("maps each zone to its primary module", () => {
    expect(Object.fromEntries(ZONES.map((z) => [z.id, zoneLink(z.id)?.href]))).toEqual({
      sales: "/deals",
      studio: "/projects",
      reception: "/intake",
      servers: "/automation",
      meeting: "/calendar",
      founder: "/dashboard",
      finance: "/finance",
    })
    expect(zoneLink("finance")).toEqual({ label: "Finance", href: "/finance" })
  })

  it("returns null for non-zone entities", () => {
    expect(zoneLink("FL-01")).toBeNull()
    expect(zoneLink("TRK-2051")).toBeNull()
    expect(zoneLink(null)).toBeNull()
  })

  it("only links to routes that exist under app/(app)", () => {
    for (const [, href] of ZONES.flatMap((z) => z.links)) {
      expect(existsSync(join(process.cwd(), "app/(app)", href, "page.tsx")), href).toBe(true)
    }
  })
})
