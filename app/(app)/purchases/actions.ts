"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import { PurchaseInput, ReceiptInput, ReturnInput } from "@/lib/purchasing/schema"
import { receivePurchaseStock } from "@/lib/purchasing/receive"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { applyReceipt } from "@/lib/purchasing/quantities"
import type { Enums } from "@/lib/types/database"

function refresh(id: string) {
  revalidatePath(`/purchases/${id}`)
  revalidatePath("/purchases")
  revalidatePath("/vendors")
  revalidatePath("/finance")
  revalidatePath("/dashboard")
}

export async function createPurchase(input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  const parsed = PurchaseInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid purchase details" }
  const db = await createClient()
  const { data, error } = await db.rpc("create_purchase_order", {
    p_org_id: ctx.orgId, p_vendor_id: parsed.data.vendor_id, p_order_date: parsed.data.order_date,
    p_expected_date: parsed.data.expected_date, p_notes: parsed.data.notes,
  })
  if (error) return { error: error.message }
  revalidatePath("/purchases")
  redirect(`/purchases/${data}`)
}

export async function transitionPurchase(id: string, status: Enums<"purchase_status">): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  if (!z.guid().safeParse(id).success || !z.enum(["confirmed", "closed", "cancelled"]).safeParse(status).success) return { error: "Invalid purchase transition" }
  const db = await createClient()
  const { error } = await db.rpc("transition_purchase_order", { p_org_id: ctx.orgId, p_order_id: id, p_status: status })
  if (error) return { error: error.message }
  refresh(id)
  return {}
}

export async function receivePurchase(id: string, input: unknown, warehouseId?: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  const parsed = ReceiptInput.safeParse(input)
  if (!z.guid().safeParse(id).success || !parsed.success || (warehouseId !== undefined && !z.guid().safeParse(warehouseId).success)) return { error: "Invalid receipt" }
  const db = await createClient()
  let receipt
  try {
    const lines = await readAllOrThrow((from, to) => db.from("purchase_order_items").select("*").eq("org_id", ctx.orgId).eq("purchase_order_id", id).order("id").range(from, to))
    receipt = applyReceipt(lines, parsed.data)
  } catch (error) { return { error: error instanceof Error ? error.message : "Invalid receipt" } }
  const { error } = await receivePurchaseStock(db, ctx.orgId, id, receipt, warehouseId)
  if (error) return { error: error.message }
  refresh(id)
  revalidatePath("/inventory", "layout")
  revalidatePath("/products", "layout")
  return {}
}

export async function returnPurchase(id: string, input: unknown, warehouseId?: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  requireCapability(ctx, "inventory:manage")
  const lines = ReturnInput.safeParse(input)
  if (!z.guid().safeParse(id).success || !lines.success || (warehouseId !== undefined && !z.guid().safeParse(warehouseId).success)) return { error: "Invalid return" }
  const db = await createClient()
  const { error } = await db.rpc("return_purchase_order", { p_org_id: ctx.orgId, p_order_id: id, p_lines: lines.data, ...(warehouseId ? { p_warehouse_id: warehouseId } : {}) })
  if (error) return { error: error.message }
  refresh(id)
  revalidatePath("/inventory", "layout")
  revalidatePath("/products", "layout")
  return {}
}

export async function createPurchaseBill(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  if (!z.guid().safeParse(id).success) return { error: "Invalid purchase" }
  const db = await createClient()
  const { error } = await db.rpc("bill_purchase_order", { p_org_id: ctx.orgId, p_order_id: id })
  if (error) return { error: error.message }
  refresh(id)
  return {}
}

export async function markBillPaid(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  if (!z.guid().safeParse(id).success) return { error: "Invalid bill" }
  const db = await createClient()
  const { data, error } = await db.from("costs").update({ paid_at: new Date().toISOString() }).eq("org_id", ctx.orgId).eq("id", id).not("vendor_id", "is", null).is("paid_at", null).select("purchase_order_id, vendor_id, bill_number").maybeSingle()
  if (error) return { error: error.message }
  if (data) {
    await writeAudit(ctx, { entity: "purchase_order", entityId: data.purchase_order_id, action: "bill_paid", summary: `Marked bill ${data.bill_number} paid`, meta: { costId: id } })
    refresh(data.purchase_order_id ?? "")
    revalidatePath(`/vendors/${data.vendor_id}`)
  }
  return {}
}
