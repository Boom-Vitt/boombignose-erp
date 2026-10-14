import { expect, it, vi } from "vitest"
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { portalMarkInvoicePaid } from "@/app/portal/[token]/portal-actions"

it("public payment action sends only a pending claim command", async () => {
  rpc.mockResolvedValue({ data: "claim-id", error: null })
  const input = {token:"opaque-test-token",invoiceId:"00000000-0000-0000-0000-000000000001",amountBaht:"1.01",reference:"Reported transfer",key:"00000000-0000-4000-8000-000000000002"}
  expect(await portalMarkInvoicePaid(input)).toEqual({})
  expect(rpc).toHaveBeenCalledWith("submit_payment_claim", {p_token:input.token,p_invoice_id:input.invoiceId,p_amount_satang:101,p_reference:input.reference,p_key:input.key})
})
