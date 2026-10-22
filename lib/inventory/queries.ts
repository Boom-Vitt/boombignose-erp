import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { readAll, readAllOrThrow } from "@/lib/supabase/read-all"
import { InventorySnapshot } from "./schema"

function checked<T>({ data, error }: { data: T[] | null; error: unknown }): T[] {
  if (error || !data) throw new Error("Inventory data unavailable. Please reload.")
  return data
}

export async function inventoryData(warehouseId?: string, productId?: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [snapshot, warehouses, vendors] = await Promise.all([
    db.rpc("inventory_snapshot", { p_org_id: ctx.orgId, ...(warehouseId ? { p_warehouse_id: warehouseId } : {}), ...(productId ? { p_product_id: productId } : {}) }),
    readAll((from, to) => db.from("warehouses").select("*").eq("org_id", ctx.orgId).order("code").order("id").range(from, to)),
    readAll((from, to) => db.from("vendors").select("id,name,active").eq("org_id", ctx.orgId).order("id").range(from, to)),
  ])
  const parsed = InventorySnapshot.safeParse(snapshot.data)
  if (snapshot.error || !parsed.success) throw new Error("Inventory data unavailable. Please reload.")
  return {
    products: parsed.data.products,
    warehouses: checked(warehouses), vendors: checked(vendors), balances: parsed.data.balances,
  }
}

export async function stockMoveCount(filter: { sourceId?: string; productId?: string }) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  let query = db.from("stock_moves").select("id", { head: true, count: "exact" }).eq("org_id", ctx.orgId)
  if (filter.sourceId) query = query.eq("source_id", filter.sourceId)
  if (filter.productId) query = query.eq("product_id", filter.productId)
  const { count, error } = await query
  if (error) throw new Error("Stock move count unavailable")
  return count ?? 0
}

export async function productStock(productId: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const { data, error } = await db.from("inventory_totals").select("quantity").eq("org_id", ctx.orgId).eq("product_id", productId).maybeSingle()
  if (error) throw new Error("Stock balance unavailable")
  return data?.quantity ?? 0
}

export async function invoiceStockData(invoiceId: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [lines, moves] = await Promise.all([
    readAllOrThrow((from, to) => db.from("invoice_stock_lines").select("*").eq("org_id", ctx.orgId).eq("invoice_id", invoiceId).eq("is_stockable", true).order("id").range(from, to)),
    readAllOrThrow((from, to) => db.from("stock_moves").select("*").eq("org_id", ctx.orgId).eq("source_type", "invoice").eq("source_id", invoiceId).order("sequence").order("id").range(from, to)),
  ])
  return { lines, moves }
}
