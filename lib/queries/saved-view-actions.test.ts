import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ inserts: [] as unknown[], filters: [] as unknown[], revalidate: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = {
    insert: async (row: unknown) => { state.inserts.push(row); return { error: null } },
    select: () => query,
    delete: () => query,
    eq: (column: string, value: unknown) => { state.filters.push([column, value]); return query },
    maybeSingle: async () => ({ data: { module: "quotes" }, error: null }),
    then: (resolve: (result: unknown) => unknown) => resolve({ error: null }),
  }
  return query
} }) }))

import { createSavedView, deleteSavedView } from "@/app/(app)/views/actions"

beforeEach(() => { state.inserts = []; state.filters = []; state.revalidate.mockClear() })

describe("saving facet views", () => {
  it.each(["quotes", "timesheets"])("persists %s URL state for the current user and organization", async (module) => {
    const config = { q: "Acme", period: "last_month", mine: "1", groupBy: "month" }
    expect(await createSavedView({ module, name: "My work", config })).toEqual({})
    expect(state.inserts).toEqual([{ module, name: "My work", config, org_id: "org", user_id: "me" }])
    expect(state.revalidate).toHaveBeenCalledWith(`/${module}`)
  })
  it.each(["draft", "draft,sent"])("persists the status filter %s", async (status) => {
    expect(await createSavedView({ module: "quotes", name: "Open", config: { status } })).toEqual({})
    expect(state.inserts).toEqual([{ module: "quotes", name: "Open", config: { status }, org_id: "org", user_id: "me" }])
  })
  it.each([{ period: "tomorrow" }, { groupBy: "unknown" }, { mine: "someone_else" }, { extra: "redirect" }])("rejects invalid facet state %j", async (config) => {
    expect(await createSavedView({ module: "quotes", name: "Invalid", config })).toHaveProperty("error")
    expect(state.inserts).toHaveLength(0)
  })
})

it("deletes a saved view whose seed-shaped ID is not an RFC UUID", async () => {
  const id = "30000000-0000-0000-0000-000000000001"
  expect(await deleteSavedView(id)).toEqual({})
  expect(state.filters).toContainEqual(["id", id])
  expect(state.revalidate).toHaveBeenCalledWith("/quotes")
})
