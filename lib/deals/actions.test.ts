import { beforeEach, describe, expect, it, vi } from "vitest"

const DEAL = "3f1c2b6e-8a4d-4e2f-9b7a-1c2d3e4f5a6b"
const AFTER = "6a2f0c1d-5b3e-4c7a-8d9e-0f1a2b3c4d5e"
const REASON = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
const CLIENT = "1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a"

const { db, writeAudit, ctx } = vi.hoisted(() => ({
  db: {
    before: null as { title: string } | null,
    rpc: vi.fn(),
    updated: [] as { id: string }[],
    update: vi.fn(),
  },
  writeAudit: vi.fn(),
  ctx: { orgId: "org-1", userId: "user-1", role: "member" },
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ctx, requireCapability: () => {} }))
vi.mock("@/lib/audit", () => ({ writeAudit }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: db.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        update: (values: unknown) => {
          db.update(values)
          return query
        },
        maybeSingle: async () => ({ data: db.before, error: null }),
        then: (resolve: (v: object) => void) => resolve({ data: db.updated, error: null }),
      }
      return query
    },
  }),
}))

import { createDeal, updateDeal, updateDealStage } from "@/app/(app)/deals/actions"

beforeEach(() => {
  vi.clearAllMocks()
  db.before = { title: "Chatbot" }
  db.updated = [{ id: DEAL }]
  db.rpc.mockResolvedValue({ data: "proposal", error: null })
})

describe("updateDealStage", () => {
  it("fails when the deal is gone instead of reporting a move", async () => {
    db.before = null
    expect(await updateDealStage(DEAL, "won")).toEqual({ error: expect.stringContaining("no longer exists") })
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("fails when the deal disappears before the move lands", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Deal not found" } })
    expect(await updateDealStage(DEAL, "won")).toEqual({ error: expect.stringContaining("no longer exists") })
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("places the card after its new neighbour, records the lost reason and audits the stage change", async () => {
    expect(await updateDealStage(DEAL, "lost", { after: AFTER, lostReasonId: REASON })).toEqual({})
    expect(db.rpc).toHaveBeenCalledWith("move_deal", {
      p_org_id: "org-1",
      p_deal_id: DEAL,
      p_stage: "lost",
      p_after_id: AFTER,
      p_lost_reason_id: REASON,
    })
    expect(writeAudit).toHaveBeenCalledWith(ctx, expect.objectContaining({
      action: "stage_changed",
      meta: { from: "proposal", to: "lost", lostReasonId: REASON },
    }))
  })

  it("reorders within a column without an audit entry", async () => {
    expect(await updateDealStage(DEAL, "proposal", { after: null })).toEqual({})
    expect(db.rpc).toHaveBeenCalledWith("move_deal", expect.objectContaining({ p_after_id: null }))
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("surfaces the database's lost-reason rule", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "Pick a lost reason" } })
    expect(await updateDealStage(DEAL, "lost")).toEqual({ error: "Pick a lost reason" })
  })
})

describe("deal form", () => {
  const input = { clientId: CLIENT, title: "Chatbot", stage: "lost" as const, valueBaht: 1000 }

  it("requires a lost reason for a lost deal", async () => {
    expect(await createDeal(input)).toEqual({ error: "Pick a lost reason" })
  })

  it("saves the probability and reason, and fails when no row was updated", async () => {
    db.updated = []
    expect(await updateDeal(DEAL, { ...input, probability: 0, lostReasonId: REASON })).toEqual({
      error: expect.stringContaining("no longer exists"),
    })
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ probability: 0, lost_reason_id: REASON }))
  })
})
