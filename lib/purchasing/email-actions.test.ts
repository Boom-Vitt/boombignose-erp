import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ rpc: vi.fn(), sendEmail: vi.fn(), configured: true, claimed: false }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", role: "owner" }), requireCapability: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: state.sendEmail, isEmailConfigured: () => state.configured }))
vi.mock("@/lib/purchasing/queries", () => ({ purchaseDetail: async () => ({
  order: { status: "draft", number: "PO-2026-001", vendors: { email: "live@example.invalid", name: "Live vendor" }, order_date: "2026-10-23", expected_date: null, notes: null },
  lines: [{ description: "Live unsnapshotted product", quantity: 2, unit: "piece", unit_cost_satang: 999 }],
}) }))

import { sendPurchaseRFQ } from "@/app/(app)/purchases/email-actions"
const id = "b6000000-0000-4000-8000-000000000020"
const deliveryKey = "b6000000-0000-4000-8000-000000000030"
const snapshot = { to: "frozen@example.invalid", number: "PO-2026-001", vendorName: "Frozen vendor", orderDate: "2026-10-23", expectedDate: null, notes: "Agreed terms", lines: [{ description: "Frozen product", quantity: 2.5, unit: "piece", unit_cost_satang: 101 }] }

beforeEach(() => {
  vi.clearAllMocks()
  state.configured = true
  state.claimed = false
  state.sendEmail.mockResolvedValue({ ok: true })
  state.rpc.mockImplementation(async (name: string) => {
    if (name !== "claim_purchase_rfq") return { data: null, error: null }
    if (state.claimed) return { data: null, error: null }
    state.claimed = true
    return { data: { delivery_key: deliveryKey, snapshot: structuredClone(snapshot) }, error: null }
  })
})

it("lets only one concurrent caller deliver the atomically frozen RFQ", async () => {
  const results = await Promise.all([sendPurchaseRFQ(id), sendPurchaseRFQ(id)])
  expect(state.sendEmail).toHaveBeenCalledTimes(1)
  expect(results.filter(result => !result.error)).toHaveLength(1)
  expect(state.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: snapshot.to, idempotencyKey: `purchase-rfq/${deliveryKey}`, html: expect.stringContaining("Frozen product") }))
  expect(state.sendEmail.mock.calls[0][0].html).not.toContain("Live unsnapshotted product")
  expect(state.sendEmail.mock.calls[0][0].html).toContain("฿2.53")
  expect(state.rpc).toHaveBeenCalledWith("finish_purchase_rfq", expect.objectContaining({ p_delivery_key: deliveryKey, p_error: null }))
})
it("does not deliver when the atomic claim fails", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Vendor email required" } })
  expect(await sendPurchaseRFQ(id)).toEqual({ error: "Vendor email required" })
  expect(state.sendEmail).not.toHaveBeenCalled()
})
it("does not freeze a draft when email is unconfigured", async () => {
  state.configured = false
  expect((await sendPurchaseRFQ(id)).error).toContain("not configured")
  expect(state.rpc).not.toHaveBeenCalled()
  expect(state.sendEmail).not.toHaveBeenCalled()
})
it("retains failed-delivery evidence and never authorizes a duplicate send", async () => {
  state.sendEmail.mockResolvedValue({ ok: false, reason: "error", error: "Provider unavailable" })
  expect((await sendPurchaseRFQ(id)).error).toContain("Provider unavailable")
  expect(state.rpc).toHaveBeenCalledWith("finish_purchase_rfq", expect.objectContaining({ p_delivery_key: deliveryKey, p_error: "Provider unavailable" }))
  await sendPurchaseRFQ(id)
  expect(state.sendEmail).toHaveBeenCalledTimes(1)
})
