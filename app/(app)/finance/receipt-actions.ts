"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { paymentAmount } from "@/lib/payments/input"
import { allocationRemainder } from "@/lib/payments/allocation"

const Allocations = z.object({ clientId: z.guid(), key: z.guid(), allocations: z.array(z.object({ invoiceId: z.guid(), amountSatang: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })) })
const Report = Allocations.extend({ amountBaht: z.string(), reference: z.string().trim().min(1).max(500) })
export async function reportCustomerReceipt(input: z.input<typeof Report>) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "payment:verify")
  const parsed = Report.safeParse(input)
  if (!parsed.success) return { error: "Invalid receipt details" }
  const d = parsed.data
  let amount: number
  try { amount = paymentAmount(d.amountBaht); allocationRemainder(amount, d.allocations) }
  catch (error) { return { error: error instanceof Error ? error.message : "Invalid allocation" } }
  const supabase = await createClient()
  const { error } = await supabase.rpc("submit_customer_payment_claim", { p_org_id: ctx.orgId, p_client_id: d.clientId, p_amount_satang: amount, p_reference: d.reference, p_key: d.key, p_allocations: d.allocations.map(a => ({ invoice_id: a.invoiceId, amount_satang: a.amountSatang })) })
  if (error) return { error: error.message }
  revalidatePath("/finance/receipts")
  return {}
}

export async function applyCustomerCredit(input: z.input<typeof Allocations>) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "payment:verify")
  const parsed = Allocations.safeParse(input)
  if (!parsed.success || !parsed.data.allocations.length) return { error: "Select invoice allocation amounts." }
  const d = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.rpc("apply_customer_credit", { p_org_id: ctx.orgId, p_client_id: d.clientId, p_key: d.key, p_allocations: d.allocations.map(a => ({ invoice_id: a.invoiceId, amount_satang: a.amountSatang })) })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath("/finance/receipts")
  revalidatePath(`/clients/${d.clientId}`)
  return {}
}

const Refund = z.object({ paymentId: z.guid(), amountBaht: z.string(), key: z.guid(), reference: z.string().trim().min(3).max(500), paidOn: z.iso.date(), method: z.enum(["transfer", "cash", "card", "promptpay", "cheque", "other"]) })
export async function refundCustomerCredit(input: z.input<typeof Refund>) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "payment:verify")
  const parsed = Refund.safeParse(input)
  if (!parsed.success) return { error: "Enter refund amount, bank date, method and reference." }
  const d = parsed.data
  let amount: number
  try { amount = paymentAmount(d.amountBaht) } catch { return { error: "Invalid refund amount" } }
  const supabase = await createClient()
  const { error } = await supabase.rpc("refund_customer_credit", { p_org_id: ctx.orgId, p_payment_id: d.paymentId, p_amount_satang: amount, p_reference: d.reference, p_paid_on: d.paidOn, p_method: d.method, p_key: d.key })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath("/finance/receipts")
  return {}
}
