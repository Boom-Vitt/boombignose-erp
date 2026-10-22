import { expect, it } from "vitest"
import { parseFacets, serializeFacets } from "@/lib/search-facets"
import { configToQueryString } from "@/app/(app)/views/view-config"

it("round trips ledger selectors, move kind and period through facets and saved views", () => {
  const input = { status: "delivery", warehouse: "b8100000-0000-4000-8000-000000000001", product: "b8100000-0000-4000-8000-000000000002", sourceId: "b8100000-0000-4000-8000-000000000003", period: "this_month" }
  const parsed = parseFacets(input, "inventory")
  expect(parsed).toEqual(input)
  expect(parseFacets(new URLSearchParams(serializeFacets(parsed, "inventory")), "inventory")).toEqual(input)
  expect(new URLSearchParams(configToQueryString(parsed)).get("product")).toBe(input.product)
  expect(parseFacets({ warehouse: "invalid", product: [input.product], status: "sent", period: "invalid" }, "inventory")).toEqual({})
  expect(parseFacets(input, "finance")).toEqual({ period: "this_month" })
})
