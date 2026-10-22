import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ inserts: [] as unknown[], revalidate: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({
  insert: async (row: unknown) => { state.inserts.push(row); return { error: null } },
}) }) }))

import { createSavedView } from "@/app/(app)/views/actions"

beforeEach(() => { state.inserts = []; state.revalidate.mockClear() })

describe("saving facet views", () => {
  it.each(["quotes", "timesheets"])("persists %s URL state for the current user and organization", async (module) => {
    const config = { q: "Acme", period: "last_month", mine: "1", groupBy: "month" }
    expect(await createSavedView({ module, name: "My work", config })).toEqual({})
    expect(state.inserts).toEqual([{ module, name: "My work", config, org_id: "org", user_id: "me" }])
    expect(state.revalidate).toHaveBeenCalledWith(`/${module}`)
  })
  it.each([{ period: "tomorrow" }, { groupBy: "unknown" }, { mine: "someone_else" }, { extra: "redirect" }])("rejects invalid facet state %j", async (config) => {
    expect(await createSavedView({ module: "quotes", name: "Invalid", config })).toHaveProperty("error")
    expect(state.inserts).toHaveLength(0)
  })
})
