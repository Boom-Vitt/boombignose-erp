import { beforeEach, describe, expect, it, vi } from "vitest"
import { isValidElement, type ReactElement, type ReactNode } from "react"

import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const { state, updateDealStage } = vi.hoisted(() => ({
  state: { client: {} as unknown },
  updateDealStage: vi.fn(async () => ({})),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "A", userId: "user", role: "member" }), requireCapability: vi.fn() }))
vi.mock("@/app/(app)/deals/actions", () => ({ updateDealStage }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))

import { DealWonOffer } from "@/app/(app)/deals/_components/deal-won-offer"
import { MarkWonButton } from "@/app/(app)/deals/_components/mark-won-button"
import { dealOptions } from "@/app/(app)/deals/_lib/deal-options"
import { createClient } from "@/lib/supabase/server"
import { createQuote, updateQuote } from "@/app/(app)/quotes/actions"

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node, ...elements(node.props.children)]
}

const openDeal = { id: "deal-1", title: "Chatbot", stage: "proposal" }

function quote(status: string, deal: object | null) {
  state.client = databaseFixture({ quotes: [{ id: "quote-1", org_id: "A", status, deal }] })
}

beforeEach(() => vi.clearAllMocks())

describe("accepting a quote offers to mark its deal won", () => {
  it("offers it on an accepted quote whose deal is still open, and marks that deal won", async () => {
    quote("accepted", openDeal)
    const offer = elements(await DealWonOffer({ quoteId: "quote-1" })).find((n) => n.type === MarkWonButton)
    expect(offer).toBeDefined()
    await (offer!.props as { onMarkWon: () => Promise<unknown> }).onMarkWon()
    expect(updateDealStage).toHaveBeenCalledWith("deal-1", "won")
  })

  it("stays quiet before acceptance, without a deal, or once the deal is won", async () => {
    for (const [status, deal] of [["sent", openDeal], ["accepted", null], ["converted", { ...openDeal, stage: "won" }]] as const) {
      quote(status, deal)
      expect(await DealWonOffer({ quoteId: "quote-1" })).toBeNull()
    }
  })
})

describe("deal options for the quote form", () => {
  it("lists open deals and keeps the closed deal a quote already links to", async () => {
    state.client = databaseFixture({
      deals: [
        { id: "open", org_id: "A", title: "Open", client_id: "c1", stage: "lead" },
        { id: "won", org_id: "A", title: "Won", client_id: "c1", stage: "won" },
        { id: "other-org", org_id: "B", title: "Elsewhere", client_id: "c9", stage: "lead" },
      ],
    })
    const supabase = await createClient()
    expect((await dealOptions(supabase, "A")).map((d) => d.value)).toEqual(["open"])
    expect((await dealOptions(supabase, "A", "won")).map((d) => d.value)).toEqual(["won", "open"])
  })
})

describe("quote form deal link", () => {
  const DEAL = "00000000-0000-4000-8000-0000000000d1"
  const CLIENT = "00000000-0000-4000-8000-0000000000c1"

  it("saves the chosen deal on create and edit, and clears it when set to none", async () => {
    const writes: Record<string, unknown>[] = []
    state.client = {
      rpc: async () => ({ data: "Q-1", error: null }),
      from: () => {
        const query = {
          select: () => query, eq: () => query, order: () => query, range: () => query,
          insert: (row: Record<string, unknown>) => { writes.push(row); return query },
          update: (row: Record<string, unknown>) => { writes.push(row); return query },
          single: async () => ({ data: { id: "quote-1" }, error: null }),
          maybeSingle: async () => ({ data: { status: "draft" }, error: null }),
          then: (resolve: (v: object) => void) => resolve({ data: [], error: null }),
        }
        return query
      },
    }
    await expect(createQuote({ client_id: CLIENT, deal_id: DEAL, number: "Q-1" })).rejects.toThrow("redirect:/quotes/quote-1")
    expect(await updateQuote({ id: "quote-1", client_id: CLIENT, deal_id: "", discountBaht: 0 })).toEqual({})
    expect(writes.map((w) => w.deal_id)).toEqual([DEAL, null])
  })
})
