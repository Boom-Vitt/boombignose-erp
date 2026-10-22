import { describe, expect, it } from "vitest"

import { MAX_TERM, SEARCH_LIMIT, searchQueries, searchTerm } from "./query"

describe("palette record search query", () => {
  it("queries every record type by name or number, five rows each", () => {
    const queries = searchQueries("acme")
    expect(queries.map((q) => [q.table, q.filter])).toEqual([
      ["clients", 'name.imatch."***=acme"'],
      ["deals", 'title.imatch."***=acme"'],
      ["quotes", 'number.imatch."***=acme"'],
      ["invoices", 'number.imatch."***=acme"'],
      ["projects", 'name.imatch."***=acme"'],
      ["products", 'name.imatch."***=acme",sku.imatch."***=acme"'],
    ])
    expect(new Set(queries.map((q) => q.limit))).toEqual(new Set([SEARCH_LIMIT]))
    expect(SEARCH_LIMIT).toBe(5)
  })

  it("matches the term literally, including *, %, _ and \\", () => {
    expect(searchQueries("*Z")[0].filter).toBe('name.imatch."***=*Z"')
    expect(searchQueries("50%_off\\")[0].filter).toBe('name.imatch."***=50%_off\\\\"')
  })

  it("quotes values so filter syntax in the term cannot add conditions", () => {
    const [clients] = searchQueries('Acme, "Co".(x),name.eq.1')
    expect(clients.filter).toBe('name.imatch."***=Acme, \\"Co\\".(x),name.eq.1"')
  })

  it("skips blank and one-character terms, collapses whitespace and caps length", () => {
    expect(searchQueries("  ")).toEqual([])
    expect(searchQueries("a")).toEqual([])
    expect(searchQueries(undefined)).toEqual([])
    expect(searchTerm("  INV\n 001 ")).toBe("INV 001")
    expect(searchTerm("x".repeat(500))).toHaveLength(MAX_TERM)
  })
})
