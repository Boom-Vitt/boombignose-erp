import { beforeEach, expect, it, vi } from "vitest"
const { rpc, gate, from } = vi.hoisted(() => ({ rpc: vi.fn(), gate: vi.fn(), from: vi.fn() }))
const orgId = "00000000-0000-4000-8000-000000000003"
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "00000000-0000-4000-8000-000000000003", role: "owner" }), requireRole: gate, requireCapability: gate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
import { issueInvoice, updateBusinessProfile, updateInvoiceWithholding } from "@/app/(app)/finance/actions"
const key = "00000000-0000-4000-8000-000000000002"
const invoiceId = "00000000-0000-0000-0000-000000000001"
beforeEach(() => { vi.clearAllMocks(); gate.mockImplementation(() => {}); rpc.mockResolvedValue({ data: "snapshot", error: null }) })
it("issuance sends exact expected version and retry key to one atomic command", async () => {
  expect(await issueInvoice({ invoiceId, expectedVersion: 4, key })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("issue_invoice", { p_org_id: orgId, p_invoice_id: invoiceId, p_expected_version: 4, p_key: key })
})
it("nonstaff and invalid versions cannot dispatch issuance", async () => {
  expect((await issueInvoice({ invoiceId, expectedVersion: -1, key })).error).toBeTruthy()
  expect((await issueInvoice({ invoiceId, expectedVersion: 0, key })).error).toBeTruthy()
  gate.mockImplementation(() => { throw new Error("denied") })
  expect((await issueInvoice({ invoiceId, expectedVersion: 4, key })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it("profile validation matches the database contract before dispatch", async () => {
  for (const value of [{ legalName: "Company", address: "Address", taxId: "", taxStatus: "registered" as const }, { legalName: "Company", address: "Address", taxId: "123", taxStatus: "unknown" as const }, { legalName: "Company", address: "A".repeat(1001), taxId: "", taxStatus: "unknown" as const }]) {
    expect((await updateBusinessProfile({ ...value, expectedOrgId: orgId })).error).toBeTruthy()
  }
  expect(rpc).not.toHaveBeenCalled()
})
it("profile update leaves tax classification explicit and trusts active org only", async () => {
  expect(await updateBusinessProfile({ expectedOrgId: orgId, legalName: "ร้านทดลอง", address: "ที่อยู่ทดลอง", taxId: "", taxStatus: "unknown" })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("update_tax_business_profile", { p_org_id: orgId, p_legal_name: "ร้านทดลอง", p_business_address: "ที่อยู่ทดลอง", p_tax_id: "", p_vat_registered: false, p_vat_rate_bps: 700, p_prices_include_vat: false, p_branch_label: "" })
})
it("stale profile form cannot save an A profile after the active org switches to B", async () => {
  expect((await updateBusinessProfile({ expectedOrgId: invoiceId, legalName: "ร้าน A", address: "ที่อยู่ A", taxId: "", taxStatus: "unknown" })).error).toContain("Workspace changed")
  expect(rpc).not.toHaveBeenCalled()
})
it("withholding reaches a draft invoice whose seeded id lacks RFC 9562 version bits", async () => {
  const seeded = "60000000-0000-0000-0000-000000000001"
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: { id: seeded }, error: null }) }
  from.mockReturnValue(query)
  expect(await updateInvoiceWithholding({ invoiceId: seeded, rateBps: 300 })).toEqual({})
  expect(query.update).toHaveBeenCalledWith({ wht_rate_bps: 300 })
  expect(query.eq).toHaveBeenCalledWith("id", seeded)
})
