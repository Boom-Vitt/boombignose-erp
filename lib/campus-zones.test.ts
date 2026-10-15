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

  it("gives every zone a unique id and a link, which the 3D scene relies on", () => {
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length)
    for (const z of ZONES) expect(z.links.length, z.id).toBeGreaterThan(0)
  })

  it("lays floors out as non-overlapping rectangles so a click picks one zone", () => {
    for (const { id, rect: [x0, z0, x1, z1] } of ZONES) {
      expect(x0 < x1 && z0 < z1, id).toBe(true)
    }
    for (const [i, a] of ZONES.entries()) {
      for (const b of ZONES.slice(i + 1)) {
        const overlap = a.rect[0] < b.rect[2] && b.rect[0] < a.rect[2] && a.rect[1] < b.rect[3] && b.rect[1] < a.rect[3]
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
  })

  it("uses hex floor colors three.js can parse", () => {
    for (const z of ZONES) expect(z.color, z.id).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
