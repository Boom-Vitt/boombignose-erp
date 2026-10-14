import { describe, expect, it, vi } from "vitest"
import {
  BLUEPRINT_FIXTURE_DATA,
  buildBlueprintScene,
} from "./scene-data"

const mockState = vi.hoisted(() => ({
  orgId: "org-1",
  role: "owner" as "owner" | "admin" | "member",
  counts: {} as Record<string, number>,
  failTable: null as string | null,
}))

vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({
    userId: "user-1",
    email: null,
    orgId: mockState.orgId,
    orgName: "Org",
    role: mockState.role,
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const filters: string[] = [table]
      let headOption = false
      const builder = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          headOption = opts?.count === "exact" && opts?.head === true
          return builder
        },
        eq(col: string, val: unknown) {
          filters.push(`${col}=${String(val)}`)
          return builder
        },
        in(col: string, vals: unknown[]) {
          filters.push(`${col} in (${vals.join(",")})`)
          return builder
        },
        not(col: string, op: string, val: unknown) {
          filters.push(`${col} not ${op} ${String(val)}`)
          return builder
        },
        then(resolve: (res: unknown) => unknown, reject?: (err: unknown) => unknown) {
          if (mockState.failTable === table) {
            return Promise.resolve({ data: null, count: null, error: { message: "boom" } }).then(
              resolve,
              reject
            )
          }
          const key = filters.join("|")
          const exactCount = mockState.counts[key] ?? mockState.counts[table] ?? 0
          // Deliberately return empty data array to prove summary reads `count`, not `data.length`
          return Promise.resolve({
            data: headOption ? null : [],
            count: headOption ? exactCount : 0,
            error: null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  }),
}))

import { getBlueprintOrgSummary } from "./queries"

describe("buildBlueprintScene", () => {
  it("maps ERP counts to the eight assemblies", () => {
    const scene = buildBlueprintScene({
      ...BLUEPRINT_FIXTURE_DATA,
      clientsTotal: 19,
      dealsOpen: 9,
      dealsWon: 4,
      dealsTotal: 15,
      quotesTotal: 12,
      quotesOpen: 5,
      quotesAcceptedOrConverted: 7,
      projectsActive: 3,
      projectsTotal: 5,
      milestonesDone: 8,
      milestonesTotal: 10,
      timeEntriesTotal: 31,
      invoicesTotal: 14,
      invoicesIssued: 11,
      invoicesPaid: 7,
      paymentClaimsPending: 3,
      paymentsVerified: 7,
      paymentAllocationsTotal: 7,
      subscriptionsActive: 4,
      outboundEventsQueued: 2,
      outboundEventsDelivered: 20,
      aiOutputsCached: 6,
      orgRole: "admin",
    })

    expect(scene.assemblies).toHaveLength(8)
    expect(scene.assemblies.map((a) => a.partNumber)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
    ])

    const crm = scene.assemblies.find((a) => a.id === "01-crm-deals")!
    expect(crm.metrics).toEqual([
      { label: "Clients", value: "19" },
      { label: "Open deals", value: "9" },
      { label: "Won deals", value: "4/15" },
    ])

    const invoices = scene.assemblies.find((a) => a.id === "04-invoices")!
    expect(invoices.codeRuleEn).toContain("satang")
    expect(invoices.codeRuleEn).toContain("bigint")

    const payments = scene.assemblies.find((a) => a.id === "05-payments")!
    expect(payments.metrics).toContainEqual({ label: "Pending claims", value: "3" })
    expect(payments.codeRuleEn).toContain("pending-only")

    const ai = scene.assemblies.find((a) => a.id === "07-ai-unit")!
    expect(ai.codeRuleEn).toContain("Gemini 4 via OpenRouter")
    expect(ai.codeRuleEn).toContain("BigNose OS")
    expect(ai.codeRuleEn).toContain("read-only")

    const housing = scene.assemblies.find((a) => a.id === "08-tenant-housing")!
    expect(housing.metrics).toContainEqual({ label: "Active role", value: "admin" })
    expect(housing.metrics).toContainEqual({ label: "Roles", value: "owner / admin / member" })
    expect(housing.codeRuleEn).toContain("org_id")
  })

  it("document token path follows quote, project, invoice, claim, verification, allocation", () => {
    const scene = buildBlueprintScene(BLUEPRINT_FIXTURE_DATA)
    expect(scene.tokenPath.map((w) => w.step)).toEqual([
      "quote",
      "project",
      "invoice",
      "claim",
      "verification",
      "allocation",
    ])
    for (const waypoint of scene.tokenPath) {
      expect(waypoint.position).toHaveLength(3)
      expect(waypoint.labelEn.length).toBeGreaterThan(0)
      expect(waypoint.labelTh.length).toBeGreaterThan(0)
    }
  })

  it("clamps negative or non-finite counts to zero", () => {
    const scene = buildBlueprintScene({
      ...BLUEPRINT_FIXTURE_DATA,
      clientsTotal: -5,
      dealsOpen: Number.NaN,
    })
    const crm = scene.assemblies.find((a) => a.id === "01-crm-deals")!
    expect(crm.metrics[0]?.value).toBe("0")
    expect(crm.metrics[1]?.value).toBe("0")
  })

  it("reads exact head counts beyond the 1000-row PostgREST cap", async () => {
    mockState.failTable = null
    mockState.role = "owner"
    mockState.counts = {
      time_entries: 1500,
      "outbound_events|org_id=org-1|status=delivered": 2450,
      ai_outputs: 1205,
      "invoices|org_id=org-1|issued_snapshot_id not is null": 1100,
    }

    const summary = await getBlueprintOrgSummary()
    expect(summary.timeEntriesTotal).toBe(1500)
    expect(summary.outboundEventsDelivered).toBe(2450)
    expect(summary.aiOutputsCached).toBe(1205)
    expect(summary.invoicesIssued).toBe(1100)
  })
})
