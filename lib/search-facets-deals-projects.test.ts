import { createElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ inserts: [] as unknown[], pathname: "/projects" }))
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }))
// The real menu portals its items only while open; render them inline so saved-view links are visible.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const { createElement } = await import("react")
  const Inline = ({ children, render }: { children?: ReactNode; render?: ReactElement }) =>
    render ?? createElement("div", null, children)
  return {
    DropdownMenu: Inline, DropdownMenuTrigger: Inline, DropdownMenuContent: Inline,
    DropdownMenuLabel: Inline, DropdownMenuItem: Inline, DropdownMenuSeparator: Inline,
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({
  insert: async (row: unknown) => { state.inserts.push(row); return { error: null } },
}) }) }))

import { SearchFacets } from "@/components/search/search-facets"
import { createSavedView } from "@/app/(app)/views/actions"
import { matchesFacets, parseFacets, serializeFacets } from "./search-facets"

beforeEach(() => { state.inserts = []; state.pathname = "/projects" })

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
  it("keeps the deals list and the projects board on saved-view links", () => {
    state.pathname = "/deals"
    const deals = renderToStaticMarkup(createElement(SearchFacets, {
      list: "deals", config: {}, params: { view: "list" },
      savedViews: [{ id: "v1", name: "By stage", config: { q: "bot", groupBy: "stage" } }],
    }))
    expect(deals).toContain('href="/deals?q=bot&amp;groupBy=stage&amp;view=list"')
    state.pathname = "/projects"
    const projects = renderToStaticMarkup(createElement(SearchFacets, {
      list: "projects", config: { status: "review" }, params: { view: "board" },
      savedViews: [{ id: "v2", name: "In review", config: { status: "review" } }],
    }))
    expect(projects).toContain('href="/projects?status=review&amp;view=board"')
  })
  it("saves project views and deal views grouped by owner or stage", async () => {
    expect(await createSavedView({ module: "projects", name: "Mine", config: { status: "review", groupBy: "owner" } })).toEqual({})
    expect(await createSavedView({ module: "deals", name: "By stage", config: { status: "won", groupBy: "stage" } })).toEqual({})
    expect(state.inserts).toHaveLength(2)
  })
})

it("keeps inventory selectors and saved-view links alongside page-owned view params", async () => {
  state.pathname = "/inventory/moves"
  const warehouse = "b8100000-0000-4000-8000-000000000001"
  const product = "b8100000-0000-4000-8000-000000000002"
  const config = { status: "delivery", warehouse, product }
  const html = renderToStaticMarkup(createElement(SearchFacets, {
    list: "inventory", config, params: { view: "list" },
    selectors: [{ key: "warehouse", label: "Warehouse", options: [{ id: warehouse, name: "Main" }] }, { key: "product", label: "Product", options: [{ id: product, name: "Goods" }] }],
    savedViews: [{ id: "stock", name: "Stock", config }],
  }))
  expect(html.match(/name="warehouse"/g)).toHaveLength(1)
  expect(html.match(/name="product"/g)).toHaveLength(1)
  expect(html).toContain('name="view" value="list"')
  expect(html).toContain(`href="/inventory/moves?status=delivery&amp;product=${product}&amp;view=list"`)
  expect(html).toContain(`href="/inventory/moves?status=delivery&amp;warehouse=${warehouse}&amp;product=${product}&amp;view=list"`)
  expect(await createSavedView({ module: "inventory", name: "Stock", config })).toEqual({})
})
