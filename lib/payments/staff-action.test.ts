import { beforeEach, expect, it, vi } from "vitest"

const { rpc, ctx, auth, client, audit } = vi.hoisted(() => ({
  rpc: vi.fn(),
  ctx: { userId: "actor", orgId: "trusted-active-org", orgName: "Workspace", role: "owner", email: null },
  auth: vi.fn(), client: vi.fn(), audit: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ctx,
  requireCapability: () => auth(),
  requireRole: () => auth(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: client }))
vi.mock("@/lib/audit", () => ({ writeAudit: audit }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

import { recordPayment, reviewPaymentClaim, reconcileLegacyPayment } from "@/app/(app)/finance/actions"

const input = {
  invoiceId: "00000000-0000-0000-0000-000000000001",
  amountBaht: "1.01", reference: "Bank report 101",
  key: "00000000-0000-4000-8000-000000000002",
}
beforeEach(() => {
  vi.clearAllMocks()
  auth.mockImplementation(() => {})
  rpc.mockResolvedValue({ data: "new-claim", error: null })
  client.mockResolvedValue({ rpc })
})

it("staff report invokes one pending-only RPC with active org and exact amount", async () => {
  expect(await recordPayment(input)).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_internal_payment_claim", {
    p_org_id: ctx.orgId, p_invoice_id: input.invoiceId, p_amount_satang: 101,
    p_reference: input.reference, p_key: input.key,
  })
  expect(audit).not.toHaveBeenCalled()
})

it("denies staff claim submission before creating a database client for members", async () => {
  auth.mockImplementation(() => { throw new Error("Forbidden") })
  expect((await recordPayment(input)).error).toContain("owners and admins")
  expect(client).not.toHaveBeenCalled()
})

it("rejects fractional/unsafe report amounts before dispatch", async () => {
  for (const amountBaht of ["1.001", "90071992547409.92", "NaN"]) {
    expect((await recordPayment({ ...input, amountBaht })).error).toBeTruthy()
  }
  expect(rpc).not.toHaveBeenCalled()
})

it("same command retry preserves its key and database evidence is authoritative", async () => {
  await recordPayment(input)
  await recordPayment(input)
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  rpc.mockResolvedValue({ data: null, error: { message: "request conflict" } })
  expect(await recordPayment(input)).toEqual({ error: "request conflict" })
})

it("review rejection ignores a displayed amount and sends zero settlement", async () => {
  expect(await reviewPaymentClaim({ ...input, claimId: input.invoiceId, decision: "rejected", amountBaht: "NaN" })).toEqual({})
  expect(rpc).toHaveBeenCalledWith("review_payment_claim", expect.objectContaining({ p_amount_satang: 0, p_decision: "rejected", p_org_id: ctx.orgId }))
})

it("legacy reconciliation creates a new verified receipt through one atomic command", async () => {
  expect(await reconcileLegacyPayment({ ...input, legacyPaymentId: input.invoiceId })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("reconcile_legacy_payment", {
    p_org_id: ctx.orgId, p_legacy_payment_id: input.invoiceId,
    p_amount_satang: 101, p_reference: input.reference, p_key: input.key,
  })
  expect(audit).not.toHaveBeenCalled()
})

it("uses bank evidence date and method when reviewing or reconciling", async () => {
  const evidence = { paidOn: "2025-01-31", method: "promptpay" as const }
  await reviewPaymentClaim({ ...input, ...evidence, claimId: input.invoiceId, decision: "verified" })
  expect(rpc).toHaveBeenCalledWith("review_payment_claim_with_evidence", expect.objectContaining({ p_paid_on: evidence.paidOn, p_method: "promptpay", p_amount_satang: 101 }))
  await reconcileLegacyPayment({ ...input, ...evidence, legacyPaymentId: input.invoiceId })
  expect(rpc).toHaveBeenCalledWith("reconcile_legacy_payment_with_evidence", expect.objectContaining({ p_paid_on: evidence.paidOn, p_method: "promptpay", p_amount_satang: 101 }))
})

it("rejects invalid or future bank dates and incomplete evidence pairs", async () => {
  for (const evidence of [{ paidOn: "2099-12-31", method: "transfer" as const }, { paidOn: "2025-02-30", method: "transfer" as const }, { paidOn: "2025-01-01" }]) {
    expect((await reviewPaymentClaim({ ...input, ...evidence, claimId: input.invoiceId, decision: "verified" })).error).toBeTruthy()
  }
  expect(rpc).not.toHaveBeenCalled()
})
