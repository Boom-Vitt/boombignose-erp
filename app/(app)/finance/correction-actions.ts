"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

const CreditNote = z.object({
  invoiceId: z.guid(), key: z.guid(), reason: z.string().trim().min(3).max(1000),
  lines: z.array(z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("quantity"), invoiceItemId: z.guid(), quantity: z.number().positive().max(999999999.999).multipleOf(0.001) }),
    z.object({ mode: z.literal("amount"), invoiceItemId: z.guid().optional(), amountSatang: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  ])).min(1),
})

export async function issueCreditNote(input: z.input<typeof CreditNote>) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "payment:verify")
  const parsed = CreditNote.safeParse(input)
  if (!parsed.success) return { error: "Enter source lines, a positive quantity or amount, and a correction reason." }
  const d = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("issue_credit_note", { p_org_id: ctx.orgId, p_invoice_id: d.invoiceId, p_key: d.key, p_reason: d.reason,
    p_lines: d.lines.map(line => line.mode === "quantity" ? { invoice_item_id: line.invoiceItemId, quantity: line.quantity } : { ...(line.invoiceItemId ? { invoice_item_id: line.invoiceItemId } : {}), amount_satang: line.amountSatang }) })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  revalidatePath("/clients")
  return { id: data }
}

const Reversal = z.object({ paymentId: z.guid(), invoiceId: z.guid().optional(), key: z.guid(), reason: z.string().trim().min(3).max(1000), reversedOn: z.iso.date() })
export async function reversePayment(input: z.input<typeof Reversal>) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "payment:verify")
  const parsed = Reversal.safeParse(input)
  if (!parsed.success) return { error: "Enter the reversal date and reason." }
  const d = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.rpc("reverse_payment", { p_org_id: ctx.orgId, p_payment_id: d.paymentId, p_reason: d.reason, p_reversed_on: d.reversedOn, p_key: d.key })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  revalidatePath("/clients")
  return {}
}
