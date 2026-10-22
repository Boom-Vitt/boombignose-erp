import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ pathname: "/deals", tables: {} as Record<string, unknown[]> }))
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ refresh: () => {} }) }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/queries/saved-views", () => ({ getFacetSavedViews: async () => [] }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let [from, to] = [0, 999]
  const query = {
    select: () => query,
    eq: () => query,
    not: () => query,
    in: () => query,
    order: () => query,
    range: (start: number, end: number) => { [from, to] = [start, end]; return query },
    // Like PostgREST, never return more than 1,000 rows per request.
    then: (resolve: (result: unknown) => unknown) =>
      resolve({ data: (state.tables[table] ?? []).slice(from, Math.min(to, from + 999) + 1), error: null }),
  }
  return query
} }) }))

import DealsPage from "@/app/(app)/deals/page"
import ProjectsPage from "@/app/(app)/projects/page"

const deal = (id: string, stage: string, owner: string, close: string | null) => ({
  id, title: `Deal ${id}`, stage, value_satang: 100, client_id: "c1", client: { name: "Acme" }, owner,
  expected_close_date: close, next_follow_up_date: null, created_at: "2026-10-01T00:00:00Z",
})
const project = (id: string, status: string, deadline: string | null) => ({
  id, name: `Project ${id}`, status, deadline, owner: "me", client_id: "c1", budget_satang: null, client: { name: "Acme" },
})

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(new Date("2026-10-23T00:00:00Z"))
  state.tables = {
    clients: [{ id: "c1", name: "Acme" }],
    profiles: [{ id: "me", full_name: "Me" }, { id: "other", full_name: "Other" }],
    deals: [deal("won1", "won", "me", "2026-10-02"), deal("lead1", "lead", "other", null), deal("prop1", "proposal", "me", "2026-12-01"), deal("neg1", "negotiation", "me", "2026-10-20")],
    projects: [project("rev1", "review", "2026-10-30"), project("ip1", "in_progress", null)],
  }
})
afterEach(() => { vi.useRealTimers() })

async function render(Page: typeof DealsPage, pathname: string, params: Record<string, string>) {
  state.pathname = pathname
  const page = await Page({ searchParams: Promise.resolve(params) })
  return renderToStaticMarkup(createElement(() => page))
}

describe("deal facets", () => {
  it("keeps legacy stage links working and shows only that column", async () => {
    const html = await render(DealsPage, "/deals", { stage: "won" })
    expect(html).toContain('aria-label="Remove Won"')
    expect(html).toContain("Deal won1")
    expect(html).not.toContain("Deal lead1")
    expect(html).not.toContain('aria-label="Lead"')
    expect(html).toContain('href="/deals/export?status=won"')
  })
  it("shows the board columns of every selected stage", async () => {
    const html = await render(DealsPage, "/deals", { status: "proposal,lead" })
    expect(html).toContain('aria-label="Remove Lead or Proposal"')
    for (const label of ["Lead", "Proposal"]) expect(html).toContain(`aria-label="${label}"`)
    for (const label of ["Contacted", "Negotiation", "Won"]) expect(html).not.toContain(`aria-label="${label}"`)
    expect(html).toContain("Deal lead1")
    expect(html).toContain("Deal prop1")
    expect(html).not.toContain("Deal won1")
    expect(html).not.toContain("Deal neg1")
    expect(html).toContain('href="/deals/export?status=lead%2Cproposal"')
  })
  it("finds a deal beyond the API's first 1,000 rows", async () => {
    state.tables.deals = [...Array.from({ length: 1000 }, (_, i) => deal(`x${i}`, "lead", "other", null)), deal("target", "proposal", "me", null)]
    const html = await render(DealsPage, "/deals", { q: "Deal target" })
    expect(html).toContain("Deal target")
    expect(html).not.toContain("No matching deals")
  })
  it("narrows the board to my deals in the expected close period", async () => {
    const html = await render(DealsPage, "/deals", { mine: "1", period: "this_month" })
    expect(html).toContain("Deal neg1")
    expect(html).not.toContain("Deal prop1")
    expect(html).not.toContain("Deal lead1")
  })
  it("groups the list by stage in pipeline order and keeps the list view on links", async () => {
    const html = await render(DealsPage, "/deals", { view: "list", groupBy: "stage" })
    const headers = [...html.matchAll(/data-testid="group-header".*?font-semibold">([^<]+)</g)].map((m) => m[1])
    expect(headers).toEqual(["Lead", "Proposal", "Negotiation", "Won"])
    const months = await render(DealsPage, "/deals", { view: "list", groupBy: "month" })
    const monthHeaders = [...months.matchAll(/data-testid="group-header".*?font-semibold">([^<]+)</g)].map((m) => m[1])
    expect(monthHeaders).toEqual(["2026-10", "2026-12", "No close date"])
    expect(html).toContain('name="view" value="list"')
    expect(html).toContain('href="/deals?groupBy=stage"')
    expect(html).toContain('href="/deals?mine=1&amp;groupBy=stage&amp;view=list"')
  })
})

describe("project facets", () => {
  it("filters the board by status and keeps the board view on chips", async () => {
    const html = await render(ProjectsPage, "/projects", { view: "board", status: "review" })
    expect(html).toContain('aria-label="Projects board"')
    expect(html).toContain("Project rev1")
    expect(html).not.toContain("Project ip1")
    expect(html).toContain('href="/projects?view=board"')
  })
  it("groups the list by deadline month with undated projects apart", async () => {
    const html = await render(ProjectsPage, "/projects", { groupBy: "month" })
    expect(html).toContain(">2026-10</span>")
    expect(html).toContain(">No deadline</span>")
    expect(html).toContain('href="/projects?groupBy=month&amp;view=board"')
  })
})
