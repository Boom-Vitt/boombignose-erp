"use server"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { formatTHB } from "@/lib/money"
import {
  sendEmail,
  renderQuoteEmailHtml,
  quoteEmailSubject,
} from "@/lib/email"

export type EmailActionResult = {
  error?: string
  ok?: boolean
  reason?: "not_configured"
}

/**
 * Email a quote to the client's first contact-on-file, with a link to its PDF,
 * then log an audit entry and an 'email' activity. Gated to any org member.
 * Degrades gracefully when email is unconfigured (returns reason:"not_configured").
 */
export async function sendQuoteEmail(
  quoteId: string
): Promise<EmailActionResult> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, number, total_satang, valid_until, client_id, clients(name)")
    .eq("id", quoteId)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (!quote) return { error: "Quote not found" }

  const { data: contact } = await supabase
    .from("contacts")
    .select("email, name")
    .eq("org_id", ctx.orgId)
    .eq("client_id", quote.client_id)
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  const to = contact?.email
  if (!to) {
    return {
      error:
        "No client email on file. Add a contact with an email to this client first.",
    }
  }

  const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL}/quotes/${quote.id}/pdf`
  const clientName = quote.clients?.name ?? null

  const res = await sendEmail({
    to,
    subject: quoteEmailSubject(quote.number),
    html: renderQuoteEmailHtml({
      number: quote.number,
      clientName,
      totalSatang: quote.total_satang,
      pdfUrl,
      validUntil: quote.valid_until,
    }),
  })

  if (!res.ok) {
    if (res.reason === "not_configured") return { ok: false, reason: "not_configured" }
    return { error: res.error ?? "Failed to send email" }
  }

  await writeAudit(ctx, {
    entity: "quote",
    entityId: quote.id,
    action: "emailed",
    summary: `Emailed quote ${quote.number} to ${to}`,
    meta: { to, total_satang: quote.total_satang },
  })

  await supabase.from("activities").insert({
    org_id: ctx.orgId,
    client_id: quote.client_id,
    type: "email",
    owner: ctx.userId,
    body: `Sent quote ${quote.number} (${formatTHB(quote.total_satang)}) to ${to}`,
  })

  return { ok: true }
}
