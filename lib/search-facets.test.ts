import { describe, expect, it } from "vitest"
import { facetValues, groupFacetRows, matchesFacets, parseFacets, serializeFacets } from "./search-facets"
import { configToHref } from "@/app/(app)/views/view-config"

describe("facet URLs and saved views", () => {
  it("round trips all facets and encodes search safely", () => {
    const config = { q: "Acme & Co + ไทย", status: "draft", period: "this_month" as const, mine: "1" as const, groupBy: "client" }
    const query = serializeFacets(config, "quotes")
    expect(parseFacets(new URLSearchParams(query), "quotes")).toEqual(config)
    expect(parseFacets(new URLSearchParams(configToHref("/quotes", config).split("?")[1]), "quotes")).toEqual(config)
  })
  it("drops unknown, repeated, unsupported and empty inputs", () => {
    expect(parseFacets({ q: "  ", status: "nope", period: "__proto__", mine: "true", groupBy: "industry", redirect: "https://example.com" }, "quotes")).toEqual({})
    expect(parseFacets({ status: ["draft", "sent"], q: "  Acme  " }, "quotes")).toEqual({ q: "Acme" })
    expect(parseFacets({ status: "draft", groupBy: "status" }, "clients")).toEqual({})
    expect(serializeFacets({}, "finance")).toBe("")
    expect(parseFacets(new URLSearchParams("status=draft&status=sent"), "quotes")).toEqual({})
    expect(parseFacets({ status: "declined" }, "quotes")).toEqual({ status: "declined" })
  })
  it("combines search, status, period and ownership without changing the input", () => {
    const config = { q: "acme", status: "sent", mine: "1" as const, period: "this_month" as const }
    const row = { text: "QUO-1 ACME", status: "sent", owner: "me", date: "2026-09-30T17:00:00Z" }
    const now = new Date("2026-10-01T00:00:00Z")
    expect(matchesFacets(config, row, "me", now)).toBe(true)
    expect(matchesFacets(config, { ...row, owner: "other" }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, status: "draft" }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, date: "2026-09-30" }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, text: "Other client" }, "me", now)).toBe(false)
    expect(config.q).toBe("acme")
  })
  it("keeps groups with the same label separate and sums integer satang", () => {
    const rows = [{ id: "a", name: "Acme", amount: 101 }, { id: "b", name: "Acme", amount: 202 }, { id: "a", name: "Acme", amount: 99 }]
    const groups = groupFacetRows(rows, (row) => ({ key: row.id, label: row.name }), (row) => row.amount)
    expect(groups.map((group) => [group.key, group.rows.length, group.totalSatang])).toEqual([["a", 2, 200], ["b", 1, 202]])
    expect(groupFacetRows([], undefined)).toEqual([])
    expect(() => groupFacetRows([{ amount: Number.MAX_SAFE_INTEGER }, { amount: 1 }], undefined, (row) => row.amount)).toThrow()
  })
})

describe("multi-value status facets", () => {
  it("round trips several statuses through the URL and the saved-view link", () => {
    const config = { status: "draft,sent", mine: "1" as const }
    const query = serializeFacets(config, "quotes")
    expect(query).toBe("status=draft%2Csent&mine=1")
    expect(parseFacets(new URLSearchParams(query), "quotes")).toEqual(config)
    expect(parseFacets(new URLSearchParams("status=draft,sent"), "quotes")).toEqual({ status: "draft,sent" })
    expect(parseFacets(new URLSearchParams(configToHref("/quotes", config).split("?")[1]), "quotes")).toEqual(config)
  })
  it("keeps only known statuses once, in the list's own order", () => {
    expect(parseFacets({ status: "sent, draft ,draft,nope,," }, "quotes")).toEqual({ status: "draft,sent" })
    expect(parseFacets({ status: "nope,also_nope" }, "quotes")).toEqual({})
    expect(parseFacets({ status: "billable,draft" }, "timesheets")).toEqual({ status: "billable" })
    expect(parseFacets({ status: "draft,sent" }, "clients")).toEqual({})
  })
  it("still rejects a repeated status key and leaves single-value links unchanged", () => {
    expect(parseFacets(new URLSearchParams("status=draft,sent&status=sent"), "quotes")).toEqual({})
    expect(parseFacets({ status: ["draft,sent", "sent"] }, "quotes")).toEqual({})
    expect(parseFacets({ status: "draft" }, "quotes")).toEqual({ status: "draft" })
    expect(serializeFacets({ status: "declined" }, "quotes")).toBe("status=declined")
  })
  it("keeps the deals stage alias, comma list included", () => {
    expect(parseFacets({ stage: "won,lead" }, "deals")).toEqual({ status: "lead,won" })
    expect(parseFacets({ stage: "won,lead", status: "proposal" }, "deals")).toEqual({ status: "proposal" })
  })
  it("splits a canonical value into its statuses", () => {
    expect(facetValues("draft,sent")).toEqual(["draft", "sent"])
    expect(facetValues("draft")).toEqual(["draft"])
    expect(facetValues("")).toEqual([])
    expect(facetValues(undefined)).toEqual([])
  })
  it("matches any selected status but still requires every other facet", () => {
    const config = { status: "draft,sent", mine: "1" as const, period: "this_month" as const, q: "acme" }
    const row = { text: "QUO-1 Acme", status: "draft", owner: "me", date: "2026-10-02" }
    const now = new Date("2026-10-15T00:00:00Z")
    expect(matchesFacets(config, row, "me", now)).toBe(true)
    expect(matchesFacets(config, { ...row, status: "sent" }, "me", now)).toBe(true)
    expect(matchesFacets(config, { ...row, status: "accepted" }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, status: undefined }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, owner: "other" }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, date: "2026-08-02" }, "me", now)).toBe(false)
    expect(matchesFacets(config, { ...row, text: "Other" }, "me", now)).toBe(false)
  })
})
