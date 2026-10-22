import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
vi.mock("next/navigation", () => ({ usePathname: () => "/quotes" }))

import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"

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
