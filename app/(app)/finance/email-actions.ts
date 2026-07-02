"use server"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { formatTHB } from "@/lib/money"
import {
  sendEmail,
  renderInvoiceEmailHtml,
  invoiceEmailSubject,
} from "@/lib/email"

export type EmailActionResult = {
  error?: string
  ok?: boolean
  reason?: "not_configured"
}

/**
 * Email an invoice to the client's first contact-on-file, with a link to its
 * PDF, then log an audit entry and an 'email' activity. Gated to any org member.
 * Degrades gracefully when email is unconfigured (returns reason:"not_configured").
 */
export async function sendInvoiceEmail(
  invoiceId: string
): Promise<EmailActionResult> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, amount_satang, due_date, client_id, clients(name)")
    .eq("id", invoiceId)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (!invoice) return { error: "Invoice not found" }

  const { data: contact } = await supabase
    .from("contacts")
    .select("email, name")
    .eq("org_id", ctx.orgId)
    .eq("client_id", invoice.client_id)
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

  const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL}/finance/invoices/${invoice.id}/pdf`
  const clientName = invoice.clients?.name ?? null

  const res = await sendEmail({
    to,
    subject: invoiceEmailSubject(invoice.number),
    html: renderInvoiceEmailHtml({
      number: invoice.number,
      clientName,
      amountSatang: invoice.amount_satang,
      pdfUrl,
      dueDate: invoice.due_date,
    }),
  })

  if (!res.ok) {
    if (res.reason === "not_configured") return { ok: false, reason: "not_configured" }
    return { error: res.error ?? "Failed to send email" }
  }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: invoice.id,
    action: "emailed",
    summary: `Emailed invoice ${invoice.number} to ${to}`,
    meta: { to, amount_satang: invoice.amount_satang },
  })

  await supabase.from("activities").insert({
    org_id: ctx.orgId,
    client_id: invoice.client_id,
    type: "email",
    owner: ctx.userId,
    body: `Sent invoice ${invoice.number} (${formatTHB(invoice.amount_satang)}) to ${to}`,
  })

  return { ok: true }
}
