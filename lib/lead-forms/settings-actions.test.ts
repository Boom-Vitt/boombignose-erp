import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  capability: vi.fn(), audit: vi.fn(), token: vi.fn(), client: vi.fn(),
  member: { data: { user_id: "b0000000-0000-0000-0000-000000000001" }, error: null } as { data: { user_id: string } | null; error: null },
  saved: { data: { id: "b6000000-0000-4000-8000-000000000020" }, error: null },
  inserted: vi.fn(), updated: vi.fn(), equals: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "workspace-a", userId: "actor" }), requireCapability: state.capability,
}))
vi.mock("@/lib/audit", () => ({ writeAudit: state.audit }))
vi.mock("@/lib/supabase/server", () => ({ createClient: state.client }))
vi.mock("./server", () => ({ generateLeadToken: state.token }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { createLeadForm, disableLeadForm } from "@/app/(app)/settings/lead-forms/actions"

beforeEach(() => {
  vi.resetAllMocks()
  state.member = { data: { user_id: "b0000000-0000-0000-0000-000000000001" }, error: null }
  state.token.mockReturnValue("a".repeat(43))
  state.client.mockImplementation(() => {
    const query = {
      select: () => query, eq: state.equals.mockImplementation(() => query),
      insert: state.inserted.mockImplementation(() => query),
      update: state.updated.mockImplementation(() => query),
      maybeSingle: async () => state.member, single: async () => state.saved,
    }
    return { from: () => query }
  })
})

function input() {
  const form = new FormData()
  form.set("name", "Website sales")
  form.set("defaultOwner", "b0000000-0000-0000-0000-000000000001")
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
  await expect(createLeadForm(input())).rejects.toThrow("REDIRECT /settings/lead-forms")
  expect(state.capability).toHaveBeenCalledWith(expect.anything(), "settings:manage")
  expect(state.inserted).toHaveBeenCalledWith({ org_id: "workspace-a", token: "a".repeat(43), name: "Website sales", default_owner: "b0000000-0000-0000-0000-000000000001", success_message: "Thank you" })
  expect(state.equals).toHaveBeenCalledWith("org_id", "workspace-a")
  expect(state.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "created", entity: "lead_form" }))
})

it("rejects an owner outside the workspace before inserting", async () => {
  state.member.data = null
  await expect(createLeadForm(input())).rejects.toThrow("error=invalid")
  expect(state.inserted).not.toHaveBeenCalled()
})

it("disables a form with both form ID and org filters", async () => {
  const form = new FormData()
  form.set("id", "b6000000-0000-4000-8000-000000000020")
  await expect(disableLeadForm(form)).rejects.toThrow("REDIRECT /settings/lead-forms")
  expect(state.updated).toHaveBeenCalledWith({ enabled: false })
  expect(state.equals).toHaveBeenCalledWith("id", "b6000000-0000-4000-8000-000000000020")
  expect(state.equals).toHaveBeenCalledWith("org_id", "workspace-a")
})
