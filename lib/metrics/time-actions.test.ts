import { beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  role: "member", owner: "someone-else", invoice: null as null | { status: string },
  mutations: [] as string[], rpc: vi.fn(), error: null as null | { message: string },
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "org", userId: "me", role: state.role }),
  requireCapability: (_ctx: unknown, capability: string) => { if (capability !== "record:write" && state.role === "member") throw new Error("Forbidden") },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: state.rpc,
  from: () => {
    const chain = {
      select: () => chain, eq: () => chain,
      update: () => { state.mutations.push("update"); return chain },
      delete: () => { state.mutations.push("delete"); return chain },
      maybeSingle: async () => ({ data: { id: "entry", user_id: state.owner, invoice_id: state.invoice ? "invoice" : null, invoices: state.invoice, project_id: "project" }, error: state.error }),
      single: async () => ({ data: { id: "entry" }, error: state.error }),
    }
    return chain
  },
}) }))
import { billTime, deleteTimeEntry, updateTimeEntry, setMemberCostRate } from "@/app/(app)/timesheets/actions"
beforeEach(() => { state.role = "member"; state.owner = "someone-else"; state.invoice = null; state.mutations = []; state.error = null; state.rpc.mockReset() })
it("does not let a member delete another author's entry", async () => {
  expect((await deleteTimeEntry({ id: "entry" })).error).toBeTruthy()
  expect(state.mutations).toEqual([])
})
it("does not let staff delete billed draft time", async () => {
  state.role = "owner"; state.invoice = { status: "draft" }
  expect((await deleteTimeEntry({ id: "entry" })).error).toBeTruthy()
  expect(state.mutations).toEqual([])
})
it("lets an author delete own unbilled time and staff delete cancelled time", async () => {
  state.owner = "me"
  expect(await deleteTimeEntry({ id: "entry" })).toEqual({})
  state.role = "admin"; state.invoice = { status: "cancelled" }
  expect(await deleteTimeEntry({ id: "entry" })).toEqual({})
  expect(state.mutations).toEqual(["delete", "delete"])
})
it("prevents updating another author's entry", async () => {
  expect((await updateTimeEntry({ id: "entry", minutes: 60, billable: true, rateBaht: "1.50", notes: "Edit" })).error).toBeTruthy()
  expect(state.mutations).toEqual([])
})
it("requires staff capability before billing and passes the org to the command", async () => {
  const input = { project_id: "d4000000-0000-4000-8000-000000000030", key: "d4000000-0000-4000-8000-000000000050" }
  expect((await billTime(input)).error).toBeTruthy()
  expect(state.rpc).not.toHaveBeenCalled()
  state.role = "owner"; state.rpc.mockResolvedValue({ data: "invoice", error: null })
  expect(await billTime(input)).toEqual({ invoiceId: "invoice" })
  expect(state.rpc).toHaveBeenCalledWith("bill_project_time", { p_org_id: "org", p_project_id: input.project_id, p_key: input.key })
})
it("bills projects and sets cost rates with database-valid seeded GUIDs", async () => {
  state.role = "owner"; state.rpc.mockResolvedValue({ data: "invoice", error: null })
  expect(await billTime({ project_id: "30000000-0000-0000-0000-000000000001", key: "d4000000-0000-4000-8000-000000000050" })).toEqual({ invoiceId: "invoice" })
  expect(await setMemberCostRate({ user_id: "00000000-0000-0000-0000-000000000001", rateBaht: "1.50" })).toEqual({})
})
it("updates own unbilled time but propagates database failures without success", async () => {
  state.owner = "me"
  expect(await updateTimeEntry({ id: "entry", minutes: 11, billable: false, rateBaht: "1.50", notes: "Own edit" })).toEqual({})
  state.error = { message: "Database unavailable" }
  expect(await deleteTimeEntry({ id: "entry" })).toEqual({ error: "Database unavailable" })
})
