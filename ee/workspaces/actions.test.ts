import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const state = vi.hoisted(() => ({ rpc: vi.fn(), cookie: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) }, rpc: state.rpc,
}) }))
vi.mock("next/headers", () => ({ cookies: async () => ({ set: state.cookie }) }))
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { createWorkspace as provisionWorkspace } from "../edition"

beforeEach(() => { vi.clearAllMocks() })
it("Pro additional-org provisioning uses its separately installed hosted command", async () => {
  state.rpc.mockResolvedValue({ data: "org-pro", error: null })
  const key = "00000000-0000-4000-8000-000000000001"
  await expect(provisionWorkspace({ name: "Additional workspace", key })).rejects.toThrow("REDIRECT:/dashboard")
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("provision_hosted_workspace", { p_name: "Additional workspace", p_key: key })
  expect(state.cookie).toHaveBeenCalledWith("active_org", "org-pro", expect.objectContaining({ httpOnly: true }))
})
it("a hosted provisioning failure does not activate a workspace", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Hosted provisioning unavailable" } })
  expect(await provisionWorkspace({ name: "Additional workspace", key: "00000000-0000-4000-8000-000000000001" })).toHaveProperty("error")
  expect(state.cookie).not.toHaveBeenCalled()
})
