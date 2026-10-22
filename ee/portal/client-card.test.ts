import { expect, it, vi } from "vitest"
import { databaseFixture, pageContent } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({ role: "member", create: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ role: state.role, orgId: "A" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: state.create }))
vi.mock("./components/portal-share-card", () => ({ PortalShareCard: () => null }))
import { ClientPortalCard } from "./client-card"

it("members cannot load portal bearer tokens", async () => {
  state.role = "member"
  state.create.mockClear()
  expect(await ClientPortalCard({ clientId: "client-A" })).toBeNull()
  expect(state.create).not.toHaveBeenCalled()
})

it("staff cannot load another organization's client portal settings", async () => {
  state.role = "owner"
  state.create.mockResolvedValue(databaseFixture({ clients: [
    { id: "client-B", org_id: "B", portal_enabled: true, portal_token: "PRIVATE_TOKEN" },
    { id: "client-A", org_id: "A", portal_enabled: true, portal_token: "OWN_TOKEN" },
  ] }))
  expect(await ClientPortalCard({ clientId: "client-B" })).toBeNull()
  const content = pageContent(await ClientPortalCard({ clientId: "client-A" }))
  expect(content).toContain("OWN_TOKEN")
  expect(content).not.toContain("PRIVATE_TOKEN")
})
