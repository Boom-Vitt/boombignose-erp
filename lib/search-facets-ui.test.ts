import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
vi.mock("next/navigation", () => ({ usePathname: () => "/quotes" }))

import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import type { FacetConfig } from "@/lib/search-facets"

const renderFacets = (config: FacetConfig) => renderToStaticMarkup(createElement(SearchFacets, { list: "quotes", savedViews: [], config }))
// A filter-panel button holds only its label, which tells it apart from a chip.
function panelLink(html: string, label: string) {
  const attributes = html.match(new RegExp(`<a ([^>]*)>${label}</a>`))?.[1] ?? ""
  return {
    href: attributes.match(/href="([^"]*)"/)?.[1],
    current: attributes.match(/aria-current="([^"]*)"/)?.[1],
  }
}

describe("facet controls and grouped sections", () => {
  it("keeps the other URL facets when a filter chip is removed or a search is submitted", () => {
    const html = renderToStaticMarkup(createElement(SearchFacets, {
      list: "quotes", savedViews: [],
      config: { q: "Acme", status: "sent", period: "this_month", mine: "1", groupBy: "status" },
    }))
    expect(html).toContain('aria-label="Remove Sent"')
    expect(html).toContain('aria-label="Remove Group by: Status"')
    expect(html).toContain('href="/quotes?q=Acme&amp;period=this_month&amp;mine=1&amp;groupBy=status"')
    expect(html).toContain('name="groupBy"')
    expect(html).toContain('name="period"')
    expect(html).toContain('aria-label="Search quotes"')
    expect(html).toContain("Save view")
  })
  it("renders each group's count and exact amount with its rows", () => {
    const html = renderToStaticMarkup(GroupedTableRows<{ id: string; amount: number }>({
      rows: [{ id: "first", amount: 101 }, { id: "second", amount: 202 }],
      colSpan: 5,
      group: () => ({ key: "sent", label: "Sent" }),
      amount: (row) => row.amount,
      children: (row) => createElement("tr", { key: row.id }, createElement("td", null, row.id)),
    }))
    expect(html).toContain('data-testid="group-header"')
    expect(html).toContain("Sent")
    expect(html).toContain("(2)")
    expect(html).toContain("฿3.03")
    expect(html).toContain("first")
    expect(html).toContain("second")
  })
})

describe("multi-value status controls", () => {
  it("toggles a status inside the list and keeps the other facets", () => {
    const one = renderFacets({ status: "sent", mine: "1" })
    expect(panelLink(one, "Draft").href).toBe("/quotes?status=draft%2Csent&amp;mine=1")
    expect(panelLink(one, "Accepted").href).toBe("/quotes?status=sent%2Caccepted&amp;mine=1")
    expect(panelLink(one, "Sent").href).toBe("/quotes?mine=1")
    const two = renderFacets({ status: "draft,sent", period: "this_month" })
    expect(panelLink(two, "Draft").href).toBe("/quotes?status=sent&amp;period=this_month")
    expect(panelLink(two, "Sent").href).toBe("/quotes?status=draft&amp;period=this_month")
    expect(panelLink(two, "Accepted").href).toBe("/quotes?status=draft%2Csent%2Caccepted&amp;period=this_month")
    expect(panelLink(renderFacets({}), "Sent").href).toBe("/quotes?status=sent")
  })
  it("marks every selected status as current", () => {
    const html = renderFacets({ status: "draft,sent", mine: "1" })
    for (const label of ["Draft", "Sent"]) expect(panelLink(html, label)).toMatchObject({ current: "true" })
    expect(panelLink(html, "Accepted")).toMatchObject({ current: undefined })
    expect(panelLink(html, "My records")).toMatchObject({ current: "true" })
  })
  it("shows one chip per group and removes the whole status group at once", () => {
    const html = renderFacets({ q: "Acme", status: "draft,sent", mine: "1", groupBy: "client" })
    expect(html.match(/data-testid="facet-chip"/g)).toHaveLength(4)
    expect(html).toContain('aria-label="Remove Draft or Sent"')
    expect(html).not.toContain('aria-label="Remove Draft"')
    expect(html).not.toContain('aria-label="Remove Sent"')
    expect(html).toMatch(/aria-label="Remove Draft or Sent"[^>]*href="\/quotes\?q=Acme&amp;mine=1&amp;groupBy=client"/)
    expect(html).toContain("Draft or Sent<svg")
  })
})
