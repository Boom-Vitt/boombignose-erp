"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import { sendEmail, isEmailConfigured } from "@/lib/email"
import { RFQClaim } from "@/lib/purchasing/schema"
import { renderRFQEmail } from "@/lib/purchasing/rfq"

export async function sendPurchaseRFQ(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  if (!z.guid().safeParse(id).success) return { error: "Invalid purchase" }
  if (!isEmailConfigured()) return { error: "Email is not configured. Print the RFQ or configure email delivery." }
  const db = await createClient()
  const claim = await db.rpc("claim_purchase_rfq", { p_org_id: ctx.orgId, p_order_id: id })
  if (claim.error) return { error: claim.error.message }
  if (!claim.data) return { error: "RFQ has already been claimed or the order is no longer draft. Delivery will not be repeated." }
  const parsed = RFQClaim.safeParse(claim.data)
  if (!parsed.success) return { error: "RFQ snapshot is invalid. No delivery was attempted." }
  const { delivery_key, snapshot } = parsed.data
  const result = await sendEmail({
    to: snapshot.to,
    subject: `Request for quotation ${snapshot.number}`,
    html: renderRFQEmail(snapshot),
    idempotencyKey: `purchase-rfq/${delivery_key}`,
  })
  const deliveryError = result.ok ? null : result.reason === "not_configured" ? "Email is not configured" : result.error ?? "Unable to send RFQ"
  const finish = await db.rpc("finish_purchase_rfq", { p_org_id: ctx.orgId, p_order_id: id, p_delivery_key: delivery_key, p_error: deliveryError })
  revalidatePath(`/purchases/${id}`)
  revalidatePath("/purchases")
  if (finish.error) return { error: `${deliveryError ?? "Email accepted"}. Delivery status could not be saved; verify delivery before recovery.` }
  if (deliveryError) return { error: `${deliveryError}. The RFQ remains frozen for delivery verification; print it if needed.` }
  await writeAudit(ctx, { entity: "purchase_order", entityId: id, action: "emailed", summary: `Sent RFQ ${snapshot.number}` })
  return {}
}
