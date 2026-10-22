"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { paymentAmount } from "@/lib/payments/input"

/**
 * PUBLIC, tokenized client-portal actions. There is NO user session here, so
 * these run on the service-role admin client (RLS is bypassed) and MUST scope
 * every read/write to the single client resolved from the opaque portal token.
 *
 * Trust boundary: the ONLY thing we trust from the caller is the token and a row
 * id. We resolve the token → client ourselves and only ever mutate rows whose
 * `client_id` equals that resolved client. Any org_id/client_id the caller might
 * send is never used. The token secret is never logged or returned.
 */

const TokenSchema = z.string().trim().min(1)

const AcceptQuote = z.object({
  token: TokenSchema,
  quoteId: z.guid(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320).pipe(z.email()),
})

export async function portalAcceptQuote(
  input: z.input<typeof AcceptQuote>
): Promise<{ error?: string }> {
  const parsed = AcceptQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid request" }
  const { token, quoteId, name, email } = parsed.data

  const { data, error } = await createAdminClient().rpc("accept_portal_quote", {
    p_token: token, p_quote_id: quoteId, p_name: name, p_email: email,
  })

  if (error) return { error: "Could not accept this quote." }
  if (!data) {
    return { error: "This quote can no longer be accepted." }
  }

  revalidatePath(`/portal/${token}`)
  return {}
}

const MarkInvoicePaid = z.object({
  token: TokenSchema,
  invoiceId: z.guid(),
  amountBaht: z.string(),
  reference: z.string().trim().min(1).max(500),
  key: z.uuid(),
})

// Kept as an exported compatibility name; the action now reports a pending claim.
export async function portalMarkInvoicePaid(input: z.input<typeof MarkInvoicePaid>): Promise<{ error?: string }> {
  const parsed = MarkInvoicePaid.safeParse(input)
  if (!parsed.success) return { error: "Invalid payment report" }
  let amount: number
  try { amount = paymentAmount(parsed.data.amountBaht) }
  catch { return { error: "Enter a valid positive payment amount" } }
  const { token, invoiceId, reference, key } = parsed.data
  const { error } = await createAdminClient().rpc("submit_payment_claim", {
    p_token: token, p_invoice_id: invoiceId, p_amount_satang: amount,
    p_reference: reference, p_key: key,
  })
  if (error) return { error: "This payment report could not be submitted. Check the invoice or contact your account manager." }
  revalidatePath(`/portal/${token}`)
  return {}
}
