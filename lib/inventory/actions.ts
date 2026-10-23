"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import { CountInput, DeliveryInput, ReorderInput, StockQuantity, TransferInput, WarehouseInput } from "./schema"

function refresh() {
  revalidatePath("/inventory", "layout")
  revalidatePath("/products", "layout")
}

export async function saveWarehouse(input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const parsed = WarehouseInput.safeParse(input)
  if (!parsed.success) return { error: "Enter a code, name and valid warehouse details." }
  const d = parsed.data
  const db = await createClient()
  const { error } = await db.rpc("save_warehouse", { p_org_id: ctx.orgId, p_id: d.id, p_code: d.code, p_name: d.name, p_address: d.address, p_default: d.is_default, p_active: d.active })
  if (error) return { error: error.message }
  refresh()
  return {}
}

export async function deleteWarehouse(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  if (!z.guid().safeParse(id).success) return { error: "Invalid warehouse" }
  const db = await createClient()
  const { error } = await db.rpc("delete_warehouse", { p_org_id: ctx.orgId, p_id: id })
  if (error) return { error: error.code === "23503" ? "This warehouse has stock history. Deactivate it instead." : error.message }
  refresh()
  return {}
}

export async function adjustStock(input: unknown): Promise<{ error?: string; rejected?: true }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const parsed = CountInput.safeParse(input)
  if (!parsed.success) return { error: "Choose a product and warehouse, and enter a nonnegative count and reason." }
  const d = parsed.data
  const db = await createClient()
  const { error } = await db.rpc("adjust_stock", { p_org_id: ctx.orgId, p_product_id: d.product_id, p_warehouse_id: d.warehouse_id, p_count: d.quantity, p_reason: d.reason, p_key: d.key, ...(d.unit_cost_satang !== undefined ? { p_unit_cost_satang: d.unit_cost_satang } : {}) })
  if (error) return { error: error.message, ...(error.code === "P0001" ? { rejected: true as const } : {}) }
  refresh()
  return {}
}

export async function deliverInvoice(id: string, warehouseId?: string, input?: unknown, date?: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const lines = input === undefined ? undefined : DeliveryInput.safeParse(input)
  if ((date !== undefined && !z.iso.date().safeParse(date).success) || !z.guid().safeParse(id).success || (warehouseId !== undefined && !z.guid().safeParse(warehouseId).success) || (lines && !lines.success)) return { error: "Invalid delivery" }
  const db = await createClient()
  const { error } = await db.rpc("deliver_invoice", { p_org_id: ctx.orgId, p_invoice_id: id, ...(warehouseId ? { p_warehouse_id: warehouseId } : {}), ...(lines?.success ? { p_lines: lines.data } : {}), ...(date ? { p_date: date } : {}) })
  if (error) return { error: error.message }
  refresh()
  revalidatePath(`/finance/invoices/${id}`)
  revalidatePath("/dashboard")
  revalidatePath("/reports")
  return {}
}

export async function returnInvoiceDelivery(id: string, moveId: string, quantity: number): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  if (!z.guid().safeParse(id).success || !z.guid().safeParse(moveId).success || !StockQuantity.safeParse(quantity).success) return { error: "Invalid return" }
  const db = await createClient()
  const { error } = await db.rpc("return_invoice_delivery", { p_org_id: ctx.orgId, p_invoice_id: id, p_move_id: moveId, p_returned_quantity: quantity })
  if (error) return { error: error.message }
  refresh()
  revalidatePath(`/finance/invoices/${id}`)
  revalidatePath("/dashboard")
  revalidatePath("/reports")
  return {}
}

export async function saveReorder(input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const parsed = ReorderInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid replenishment rule" }
  const { product_id, ...values } = parsed.data
  const db = await createClient()
  const { data, error } = await db.from("products").update(values).eq("org_id", ctx.orgId).eq("id", product_id).eq("is_stockable", true).select("id").maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "Stockable product unavailable" }
  await writeAudit(ctx, { entity: "product", entityId: product_id, action: "reorder_updated", summary: "Updated replenishment rule" })
  refresh()
  return {}
}

export async function createReplenishment(vendorId: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  requireCapability(ctx, "purchase:manage")
  if (!z.guid().safeParse(vendorId).success) return { error: "Invalid vendor" }
  const db = await createClient()
  const { data, error } = await db.rpc("create_replenishment_rfq", { p_org_id: ctx.orgId, p_vendor_id: vendorId })
  if (error) return { error: error.message }
  revalidatePath("/purchases")
  refresh()
  redirect(`/purchases/${data}`)
}

export async function setNegativeStock(allow: boolean): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  if (typeof allow !== "boolean") return { error: "Invalid stock policy" }
  const db = await createClient()
  const { error } = await db.from("org_settings").upsert({ org_id: ctx.orgId, allow_negative_stock: allow }, { onConflict: "org_id" })
  if (error) return { error: error.message }
  await writeAudit(ctx, { entity: "settings", action: "stock_policy_updated", summary: `Negative stock ${allow ? "allowed" : "blocked"}` })
  refresh()
  return {}
}

export async function transferStock(input: unknown): Promise<{ error?: string; rejected?: true }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const parsed = TransferInput.safeParse(input)
  if (!parsed.success) return { error: "Choose different warehouses, a positive quantity and a reason." }
  const d = parsed.data
  const db = await createClient()
  const { error } = await db.rpc("transfer_stock", { p_org_id: ctx.orgId, p_product_id: d.product_id, p_from_warehouse_id: d.from_warehouse_id, p_to_warehouse_id: d.to_warehouse_id, p_quantity: d.quantity, p_reason: d.reason, p_key: d.key })
  if (error) return { error: error.message, ...(error.code === "P0001" ? { rejected: true as const } : {}) }
  refresh()
  return {}
}

export async function savePurchasingPolicy(input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const parsed = z.object({ purchase_approval_threshold_satang: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), over_receipt_tolerance_percent: z.number().finite().min(0).max(100).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001) }).safeParse(input)
  if (!parsed.success) return { error: "Enter a tolerance from 0 to 100 with up to two decimals." }
  const db = await createClient()
  const { error } = await db.from("org_settings").upsert({ org_id: ctx.orgId, ...parsed.data }, { onConflict: "org_id" })
  if (error) return { error: error.message }
  await writeAudit(ctx, { entity: "settings", action: "purchase_policy_updated", summary: "Updated purchasing policy" })
  revalidatePath("/settings/purchasing")
  revalidatePath("/purchases", "layout")
  return {}
}
