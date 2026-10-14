import { describe, expect, it } from "vitest"
import {
  BLUEPRINT_FIXTURE_DATA,
  buildBlueprintScene,
} from "./scene-data"

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
      membershipsTotal: 5,
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
})
