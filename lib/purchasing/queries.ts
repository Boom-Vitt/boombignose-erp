import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { todayISO } from "@/lib/dates"
import { allPurchasingRows } from "./pagination"
import { notFound } from "next/navigation"
import type { ProductOption } from "@/lib/products/snapshot"

export type PurchaseProduct = ProductOption & { cost_satang: number }
export async function purchaseOptions() {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [vendors, products] = await Promise.all([
    allPurchasingRows((from, to) => db.from("vendors").select("id,name").eq("org_id", ctx.orgId).eq("active", true).order("name").order("id").range(from, to)),
    allPurchasingRows((from, to) => db.from("products").select("id,sku,name,description,unit,list_price_satang,cost_satang").eq("org_id", ctx.orgId).eq("active", true).order("name").order("id").range(from, to)),
  ])
  return { vendors, products }
}

export async function purchaseDetail(id: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [order, lines, bills] = await Promise.all([
    db.from("purchase_orders").select("*,vendors(*)").eq("org_id", ctx.orgId).eq("id", id).maybeSingle(),
    allPurchasingRows((from, to) => db.from("purchase_order_items").select("*").eq("org_id", ctx.orgId).eq("purchase_order_id", id).order("position").order("id").range(from, to)),
    allPurchasingRows((from, to) => db.from("costs").select("*").eq("org_id", ctx.orgId).eq("purchase_order_id", id).order("created_at").order("id").range(from, to)),
  ])
  if (order.error) throw new Error("Purchase data unavailable. Please reload.")
  if (!order.data) notFound()
  return { order: order.data, lines, bills }
}

export async function vendorDetail(id: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [vendor, orders, bills] = await Promise.all([
    db.from("vendors").select("*").eq("org_id", ctx.orgId).eq("id", id).maybeSingle(),
    allPurchasingRows((from, to) => db.from("purchase_orders").select("*").eq("org_id", ctx.orgId).eq("vendor_id", id).order("order_date", { ascending: false }).order("id").range(from, to)),
    allPurchasingRows((from, to) => db.from("costs").select("*").eq("org_id", ctx.orgId).eq("vendor_id", id).order("created_at", { ascending: false }).order("id").range(from, to)),
  ])
  if (vendor.error) throw new Error("Vendor data unavailable. Please reload.")
  if (!vendor.data) notFound()
  return { vendor: vendor.data, orders, bills }
}

export async function overdueVendorBillCount() {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const { count, error } = await db.from("costs").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).not("vendor_id", "is", null).is("paid_at", null).lt("due_date", todayISO())
  if (error) throw new Error("Vendor bill attention count unavailable")
  return count ?? 0
}
