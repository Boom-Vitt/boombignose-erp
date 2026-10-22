"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import { sendEmail } from "@/lib/email"
import { purchaseDetail } from "@/lib/purchasing/queries"
import { renderRFQEmail } from "@/lib/purchasing/rfq"

export async function sendPurchaseRFQ(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  if (!z.uuid().safeParse(id).success) return { error: "Invalid purchase" }
  const { order, lines } = await purchaseDetail(id)
  if (order.status !== "draft") return { error: "Only draft RFQs can be sent" }
  if (!lines.length) return { error: "Add purchase lines first" }
  if (!order.vendors?.email) return { error: "Add an email address to the vendor first" }
  const result = await sendEmail({
    to: order.vendors.email,
    subject: `Request for quotation ${order.number}`,
    html: renderRFQEmail({ number: order.number, vendorName: order.vendors.name, orderDate: order.order_date, expectedDate: order.expected_date, notes: order.notes, lines }),
  })
  if (!result.ok) return { error: result.reason === "not_configured" ? "Email is not configured. Print the RFQ or configure email delivery." : result.error ?? "Unable to send RFQ" }
  const db = await createClient()
  const { error } = await db.rpc("transition_purchase_order", { p_org_id: ctx.orgId, p_order_id: id, p_status: "sent" })
  if (error) return { error: `Email sent, but the status could not be updated: ${error.message}` }
  await writeAudit(ctx, { entity: "purchase_order", entityId: id, action: "emailed", summary: `Sent RFQ ${order.number}` })
  revalidatePath(`/purchases/${id}`)
  revalidatePath("/purchases")
  return {}
}
