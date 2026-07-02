"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"

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
  // Typed-name e-signature: the client types their full name as intent to
  // accept. Not a cryptographic signature — just an auditable record of consent.
  signerName: z.string().trim().min(1).max(200),
})

export async function portalAcceptQuote(
  input: z.input<typeof AcceptQuote>
): Promise<{ error?: string }> {
  const parsed = AcceptQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid request" }
  const { token, quoteId, signerName } = parsed.data

  const supabase = createAdminClient()
  const client = await resolveClient(supabase, token)
  if (!client) return { error: "This portal is unavailable." }

  // Only a 'sent' quote that belongs to THIS client can be accepted. The
  // client_id + status filters make the update a no-op for anything else.
  // Record the typed signature (name + timestamp) atomically with the accept.
  const { data, error } = await supabase
    .from("quotes")
    .update({
      status: "accepted",
      signed_name: signerName,
      signed_at: new Date().toISOString(),
    })
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
  invoiceId: z.string().min(1),
})

export async function portalMarkInvoicePaid(
  input: z.input<typeof MarkInvoicePaid>
): Promise<{ error?: string }> {
  const parsed = MarkInvoicePaid.safeParse(input)
  if (!parsed.success) return { error: "Invalid request" }
  const { token, invoiceId } = parsed.data

  const supabase = createAdminClient()
  const client = await resolveClient(supabase, token)
  if (!client) return { error: "This portal is unavailable." }

  // Load the invoice, strictly scoped to the resolved client.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, amount_satang, status")
    .eq("id", invoiceId)
    .eq("client_id", client.id)
    .eq("org_id", client.org_id)
    .maybeSingle()

  if (invErr || !invoice) return { error: "Invoice not found." }
  if (invoice.status === "paid" || invoice.status === "cancelled") {
    return { error: "This invoice can no longer be marked as paid." }
  }

  // Sum existing payments to compute the outstanding amount to settle.
  const { data: payments, error: sumErr } = await supabase
    .from("payments")
    .select("amount_satang")
    .eq("invoice_id", invoice.id)
    .eq("org_id", client.org_id)

  if (sumErr) return { error: "Could not record payment." }

  const paid = (payments ?? []).reduce((acc, p) => acc + p.amount_satang, 0)
  const outstanding = Math.max(0, invoice.amount_satang - paid)

  if (outstanding > 0) {
    const { error: payErr } = await supabase.from("payments").insert({
      org_id: client.org_id,
      invoice_id: invoice.id,
      amount_satang: outstanding,
      method: "transfer",
      notes: "Marked paid via client portal",
    })
    if (payErr) return { error: "Could not record payment." }
  }

  const { error: updErr } = await supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("id", invoice.id)
    .eq("client_id", client.id)
    .eq("org_id", client.org_id)

  if (updErr) return { error: "Could not update the invoice." }

  revalidatePath(`/portal/${token}`)
  return {}
}
