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

type ResolvedClient = { id: string; org_id: string }

/**
 * Resolve an enabled portal token to its owning client, or null. Never leaks
 * whether a token existed; callers surface a generic "unavailable" error.
 */
async function resolveClient(
  supabase: ReturnType<typeof createAdminClient>,
  token: string
): Promise<ResolvedClient | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, org_id")
    .eq("portal_token", token)
    .eq("portal_enabled", true)
    .maybeSingle()

  if (error || !data) return null
  return data
}

const AcceptQuote = z.object({
  token: TokenSchema,
  quoteId: z.string().min(1),
})

export async function portalAcceptQuote(
  input: z.input<typeof AcceptQuote>
): Promise<{ error?: string }> {
  const parsed = AcceptQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid request" }
  const { token, quoteId } = parsed.data

  const supabase = createAdminClient()
  const client = await resolveClient(supabase, token)
  if (!client) return { error: "This portal is unavailable." }

  // Only a 'sent' quote that belongs to THIS client can be accepted. The
  // client_id + status filters make the update a no-op for anything else.
  const { data, error } = await supabase
    .from("quotes")
    .update({ status: "accepted" })
    .eq("id", quoteId)
    .eq("client_id", client.id)
    .eq("org_id", client.org_id)
    .eq("status", "sent")
    .select("id")

  if (error) return { error: "Could not accept this quote." }
  if (!data || data.length === 0) {
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
