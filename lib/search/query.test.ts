import { describe, expect, it } from "vitest"

import { MAX_TERM, SEARCH_LIMIT, containsPattern, searchQueries, searchTerm } from "./query"

describe("palette record search query", () => {
  it("queries every record type by name or number, five rows each", () => {
    const queries = searchQueries("acme")
    expect(queries.map((q) => [q.table, q.filter])).toEqual([
      ["clients", 'name.ilike."%acme%"'],
      ["deals", 'title.ilike."%acme%"'],
      ["quotes", 'number.ilike."%acme%"'],
      ["invoices", 'number.ilike."%acme%"'],
      ["projects", 'name.ilike."%acme%"'],
      ["products", 'name.ilike."%acme%",sku.ilike."%acme%"'],
    ])
    expect(new Set(queries.map((q) => q.limit))).toEqual(new Set([SEARCH_LIMIT]))
    expect(SEARCH_LIMIT).toBe(5)
  })

  it("takes LIKE wildcards and the escape character literally", () => {
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%")
  })

  it("quotes values so filter syntax in the term cannot add conditions", () => {
    const [clients] = searchQueries('Acme, "Co".(x),name.eq.1')
    expect(clients.filter).toBe('name.ilike."%Acme, \\"Co\\".(x),name.eq.1%"')
  })

  it("skips blank and one-character terms, collapses whitespace and caps length", () => {
    expect(searchQueries("  ")).toEqual([])
    expect(searchQueries("a")).toEqual([])
    expect(searchQueries(undefined)).toEqual([])
    expect(searchTerm("  INV\n 001 ")).toBe("INV 001")
    expect(searchTerm("x".repeat(500))).toHaveLength(MAX_TERM)
  })
})
