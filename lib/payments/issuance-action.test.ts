import { beforeEach, expect, it, vi } from "vitest"
const { rpc, gate } = vi.hoisted(() => ({ rpc: vi.fn(), gate: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active", role: "owner" }), requireRole: gate, requireCapability: gate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
import { issueInvoice, updateBusinessProfile } from "@/app/(app)/finance/actions"
const key = "00000000-0000-4000-8000-000000000002"
const invoiceId = "00000000-0000-0000-0000-000000000001"
beforeEach(() => { vi.clearAllMocks(); gate.mockImplementation(() => {}); rpc.mockResolvedValue({ data: "snapshot", error: null }) })
it("issuance sends exact expected version and retry key to one atomic command", async () => {
  expect(await issueInvoice({ invoiceId, expectedVersion: 4, key })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("issue_invoice", { p_org_id: "active", p_invoice_id: invoiceId, p_expected_version: 4, p_key: key })
})
it("nonstaff and invalid versions cannot dispatch issuance", async () => {
  expect((await issueInvoice({ invoiceId, expectedVersion: -1, key })).error).toBeTruthy()
  gate.mockImplementation(() => { throw new Error("denied") })
  expect((await issueInvoice({ invoiceId, expectedVersion: 4, key })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it("profile update leaves tax classification explicit and trusts active org only", async () => {
  expect(await updateBusinessProfile({ legalName: "ร้านทดลอง", address: "ที่อยู่ทดลอง", taxId: "", taxStatus: "unknown" })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("update_business_profile", { p_org_id: "active", p_legal_name: "ร้านทดลอง", p_business_address: "ที่อยู่ทดลอง", p_tax_id: null, p_tax_status: "unknown" })
})
