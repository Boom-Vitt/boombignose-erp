import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  ownerId: "b0000000-0000-0000-0000-000000000001",
  teammateId: "b0000000-0000-0000-0000-000000000002",
  capability: vi.fn(), audit: vi.fn(), token: vi.fn(), client: vi.fn(), rpc: vi.fn(),
  saved: { data: { id: "b6000000-0000-4000-8000-000000000020" }, error: null },
  inserted: vi.fn(), updated: vi.fn(), equals: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "workspace-a", userId: state.ownerId }), requireCapability: state.capability,
}))
vi.mock("@/lib/audit", () => ({ writeAudit: state.audit }))
vi.mock("@/lib/supabase/server", () => ({ createClient: state.client }))
vi.mock("./server", () => ({ generateLeadToken: state.token }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { createLeadForm, disableLeadForm } from "@/app/(app)/settings/lead-forms/actions"

beforeEach(() => {
  vi.resetAllMocks()
  state.rpc.mockResolvedValue({ data: [{ user_id: state.ownerId }, { user_id: state.teammateId }], error: null })
  state.token.mockReturnValue("a".repeat(43))
  state.client.mockImplementation(() => ({ rpc: state.rpc, from: (table: string) => {
    const filters = new Map<string, unknown>()
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        state.equals(column, value)
        filters.set(column, value)
        return query
      },
      insert: state.inserted.mockImplementation(() => query),
      update: state.updated.mockImplementation(() => query),
      maybeSingle: async () => table === "memberships"
        ? { data: filters.get("user_id") === state.ownerId ? { user_id: state.ownerId } : null, error: null }
        : state.saved,
      single: async () => state.saved,
    }
    return query
  } }))
})

function input() {
  const form = new FormData()
  form.set("name", "Website sales")
  form.set("defaultOwner", state.ownerId)
  form.set("successMessage", "Thank you")
  form.set("org_id", "forged-workspace")
  return form
}

it("requires settings capability before creating or disabling a form", async () => {
  state.capability.mockImplementation(() => { throw new Error("Forbidden") })
  await expect(createLeadForm(input())).rejects.toThrow("Forbidden")
  await expect(disableLeadForm(input())).rejects.toThrow("Forbidden")
  expect(state.client).not.toHaveBeenCalled()
})

it("creates a form only for the active org and a verified member including seeded UUIDs", async () => {
  await expect(createLeadForm(input())).rejects.toThrow(/^REDIRECT \/settings\/lead-forms$/)
  expect(state.capability).toHaveBeenCalledWith(expect.anything(), "settings:manage")
  expect(state.inserted).toHaveBeenCalledWith({ org_id: "workspace-a", token: "a".repeat(43), name: "Website sales", default_owner: state.ownerId, success_message: "Thank you" })
  expect(state.rpc).toHaveBeenCalledWith("record_activity_assignees", { p_org_id: "workspace-a" })
  expect(state.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "created", entity: "lead_form" }))
})

it("rejects an owner outside the workspace before inserting", async () => {
  const form = input()
  form.set("defaultOwner", "b0000000-0000-0000-0000-000000000003")
  await expect(createLeadForm(form)).rejects.toThrow("error=invalid")
  expect(state.inserted).not.toHaveBeenCalled()
})

it("accepts another team member despite own-only membership visibility", async () => {
  const form = input()
  form.set("defaultOwner", state.teammateId)
  await expect(createLeadForm(form)).rejects.toThrow(/^REDIRECT \/settings\/lead-forms$/)
  expect(state.inserted).toHaveBeenCalledWith(expect.objectContaining({ org_id: "workspace-a", default_owner: state.teammateId }))
})

it.each([
  { data: null, error: { message: "Unable to load assignees" } },
  { data: null, error: null },
])("does not create a form when assignees cannot be verified", async result => {
  state.rpc.mockResolvedValue(result)
  await expect(createLeadForm(input())).rejects.toThrow("error=invalid")
  expect(state.inserted).not.toHaveBeenCalled()
})

it("disables a form with both form ID and org filters", async () => {
  const form = new FormData()
  form.set("id", "b6000000-0000-4000-8000-000000000020")
  await expect(disableLeadForm(form)).rejects.toThrow(/^REDIRECT \/settings\/lead-forms$/)
  expect(state.updated).toHaveBeenCalledWith({ enabled: false })
  expect(state.equals).toHaveBeenCalledWith("id", "b6000000-0000-4000-8000-000000000020")
  expect(state.equals).toHaveBeenCalledWith("org_id", "workspace-a")
})
