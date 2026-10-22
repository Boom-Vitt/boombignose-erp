import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  clients: [] as Array<{ id: string; name: string; industry: string | null; source: string | null }>,
  patterns: [] as [string, string][],
}))
vi.mock("next/navigation", () => ({ usePathname: () => "/clients" }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/queries/saved-views", () => ({ getFacetSavedViews: async () => [] }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  let namePattern: string | undefined
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    ilike: (column: string, pattern: string) => {
      state.patterns.push([column, pattern])
      namePattern = pattern
      return query
    },
    then: (resolve: (result: unknown) => unknown) => {
      const needle = namePattern?.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase()
      const data = state.clients.filter((client) => needle === undefined || client.name.toLowerCase().includes(needle))
        .slice(0, 1000)
        .map((client) => ({ ...client, created_at: "2026-10-01", owner: "me", deals: [{ count: 0 }] }))
      return resolve({ data, error: null })
    },
  }
  return query
} }) }))

import ClientsPage from "@/app/(app)/clients/page"

beforeEach(() => {
  state.clients = []
  state.patterns = []
  vi.useFakeTimers().setSystemTime(new Date("2026-10-23T00:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

async function renderClients(params: Record<string, string>) {
  const page = await ClientsPage({ searchParams: Promise.resolve(params) })
  return renderToStaticMarkup(createElement(() => page))
}

describe("client search and groups", () => {
  it("finds a matching client beyond the API's first 1000 rows", async () => {
    state.clients = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), name: `A client ${index}`, industry: null, source: null }))
    state.clients.push({ id: "target", name: "Z Target client", industry: null, source: null })
    const html = await renderClients({ q: "Target", mine: "1", period: "this_month" })
    expect(state.patterns).toEqual([["name", "%Target%"]])
    expect(html).toContain("Z Target client")
    expect(html).not.toContain("No matching clients")
  })
  it("escapes LIKE wildcards, backslashes and PostgREST punctuation in the server predicate", async () => {
    const name = 'Z %_\\,().:" client'
    state.clients = [{ id: "literal", name, industry: null, source: null }]
    const html = await renderClients({ q: name })
    expect(state.patterns).toEqual([["name", '%Z \\%\\_\\\\\\,\\(\\)\\.\\:\\" client%']])
    expect(html).toContain('href="/clients/literal"')
    expect(html).not.toContain("No matching clients")
  })
  it.each(["industry", "source"])("keeps missing %s separate from literal unassigned values", async (groupBy) => {
    state.clients = [
      { id: "missing", name: "Missing value", industry: null, source: null },
      { id: "literal", name: "Literal value", industry: "unassigned", source: "unassigned" },
    ]
    const html = await renderClients({ groupBy })
    expect(html.match(/data-testid="group-header"/g)).toHaveLength(2)
    expect(html).toContain(">Unassigned</span>")
    expect(html).toContain(">unassigned</span>")
    expect(html).not.toContain("(2)")
  })
})
