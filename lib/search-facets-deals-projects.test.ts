import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ inserts: [] as unknown[] }))
vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({
  insert: async (row: unknown) => { state.inserts.push(row); return { error: null } },
}) }) }))

import { SearchFacets } from "@/components/search/search-facets"
import { createSavedView } from "@/app/(app)/views/actions"
import { matchesFacets, parseFacets, serializeFacets } from "./search-facets"

beforeEach(() => { state.inserts = [] })

describe("deal and project facets", () => {
  it("reads legacy deal stage links and saved views as the stage filter", () => {
    expect(parseFacets({ stage: "won", q: "bot" }, "deals")).toEqual({ status: "won", q: "bot" })
    expect(parseFacets(new URLSearchParams("stage=won&status=lead"), "deals")).toEqual({ status: "lead" })
    expect(serializeFacets(parseFacets({ stage: "proposal" }, "deals"), "deals")).toBe("status=proposal")
    expect(parseFacets({ stage: "nope" }, "deals")).toEqual({})
    expect(parseFacets({ stage: "draft" }, "quotes")).toEqual({})
  })
  it("accepts each list's own stages, statuses and groupings only", () => {
    const deal = { status: "negotiation", period: "this_quarter", mine: "1", groupBy: "owner" }
    expect(parseFacets(deal, "deals")).toEqual(deal)
    expect(parseFacets({ groupBy: "stage" }, "deals")).toEqual({ groupBy: "stage" })
    expect(parseFacets({ groupBy: "status" }, "deals")).toEqual({})
    const project = { status: "in_progress", groupBy: "status" }
    expect(parseFacets(project, "projects")).toEqual(project)
    expect(parseFacets({ status: "negotiation", groupBy: "stage" }, "projects")).toEqual({})
  })
  it("never puts an undated record in a period", () => {
    const row = { text: "Website", status: "in_progress", date: null, owner: "me" }
    expect(matchesFacets({ period: "this_month" }, row, "me")).toBe(false)
    expect(matchesFacets({ status: "in_progress", mine: "1" }, row, "me")).toBe(true)
  })
  it("keeps the board view on every facet link and search", () => {
    const html = renderToStaticMarkup(createElement(SearchFacets, {
      list: "projects", savedViews: [], config: { status: "review" }, params: { view: "board" },
    }))
    expect(html).toContain('aria-label="Remove Review"')
    expect(html).toContain('href="/projects?view=board"')
    expect(html).toContain('href="/projects?status=review&amp;mine=1&amp;view=board"')
    expect(html).toContain('name="view" value="board"')
    expect(html).toContain("Period uses the deadline.")
  })
  it("saves project views and deal views grouped by owner or stage", async () => {
    expect(await createSavedView({ module: "projects", name: "Mine", config: { status: "review", groupBy: "owner" } })).toEqual({})
    expect(await createSavedView({ module: "deals", name: "By stage", config: { status: "won", groupBy: "stage" } })).toEqual({})
    expect(state.inserts).toHaveLength(2)
  })
})
