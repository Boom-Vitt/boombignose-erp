"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireRole } from "@/lib/auth"
import { invoiceLineAmount, moneyInput } from "@/lib/payments/input"
import { writeAudit } from "@/lib/audit"

// Invoice item mutation and discounted header recompute are one DB transaction.
// A separate header write can corrupt discounts or leave a persisted line behind.

const AddInvoiceItem = z.object({
  invoice_id: z.string().min(1),
  description: z.string().trim().min(1, "Description is required"),
  quantity: z.string().refine(v => { try { invoiceLineAmount(v, 0); return true } catch { return false } }, "Enter a positive quantity with up to three decimals"),
  unitPriceBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter an exact nonnegative THB price"),
})

export async function addInvoiceItem(
  input: z.input<typeof AddInvoiceItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireRole(ctx, ["owner", "admin"]) }
  catch { return { error: "Only owners and admins can edit invoice lines." } }
  const parsed = AddInvoiceItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  // A paid invoice is locked: its items are frozen so the derived amount can't drift.
  const { data: parent, error: parentErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", d.invoice_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (!parent) return { error: "Invoice not found" }
  if (parent.status === "paid") {
    return { error: "This invoice is paid and locked" }
  }

  // Position = current item count (org-scoped, this invoice).
  const { count, error: countErr } = await supabase
    .from("invoice_items")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", d.invoice_id)
    .eq("org_id", ctx.orgId)

  if (countErr) return { error: countErr.message }

  const unitPriceSatang = moneyInput(d.unitPriceBaht)
  let amount: number
  try { amount = invoiceLineAmount(d.quantity, unitPriceSatang) }
  catch { return { error: "Line total exceeds safe bounds" } }
  const { error: insErr } = await supabase.from("invoice_items").insert({
    org_id: ctx.orgId,
    invoice_id: d.invoice_id,
    description: d.description,
    quantity: Number(d.quantity),
    unit_price_satang: unitPriceSatang,
    amount_satang: amount,
    position: count ?? 0,
  })

  if (insErr) return { error: insErr.message }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: d.invoice_id,
    action: "item_added",
    summary: `Added line item "${d.description}" to invoice`,
    meta: { invoiceId: d.invoice_id },
  })

  revalidatePath(`/finance/invoices/${d.invoice_id}`)
  return {}
}

const DeleteInvoiceItem = z.object({ id: z.string().min(1) })

export async function deleteInvoiceItem(
  input: z.input<typeof DeleteInvoiceItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireRole(ctx, ["owner", "admin"]) }
  catch { return { error: "Only owners and admins can edit invoice lines." } }
  const parsed = DeleteInvoiceItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()

  // Resolve the parent invoice (org-scoped) so we can recompute + revalidate.
  const { data: item, error: findErr } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, description")
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (findErr) return { error: findErr.message }
  if (!item) return { error: "Line item not found" }

  // A paid invoice is locked: items cannot be removed.
  const { data: parent, error: parentErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", item.invoice_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (parent?.status === "paid") {
    return { error: "This invoice is paid and locked" }
  }

  const { error: delErr } = await supabase
    .from("invoice_items")
    .delete()
    .eq("id", item.id)
    .eq("org_id", ctx.orgId)

  if (delErr) return { error: delErr.message }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: item.invoice_id,
    action: "item_deleted",
    summary: `Removed line item "${item.description}" from invoice`,
    meta: { invoiceId: item.invoice_id },
  })

  revalidatePath(`/finance/invoices/${item.invoice_id}`)
  return {}
}
