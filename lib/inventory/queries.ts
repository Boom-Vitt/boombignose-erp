import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { readAll } from "@/lib/supabase/read-all"
import { sumSatang } from "@/lib/money"
import type { Tables } from "@/lib/types/database"

function checked<T>({ data, error }: { data: T[] | null; error: unknown }): T[] {
  if (error || !data) throw new Error("Inventory data unavailable. Please reload.")
  return data
}

export async function inventoryData(warehouseId?: string, productId?: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [products, warehouses, balances, vendors] = await Promise.all([
    readAll((from, to) => db.from("products").select("*").eq("org_id", ctx.orgId).eq("is_stockable", true).order("name").order("id").range(from, to)),
    readAll((from, to) => db.from("warehouses").select("*").eq("org_id", ctx.orgId).order("code").order("id").range(from, to)),
    readAll((from, to) => {
      let query = db.from("stock_on_hand").select("*").eq("org_id", ctx.orgId)
      if (warehouseId) query = query.eq("warehouse_id", warehouseId)
      if (productId) query = query.eq("product_id", productId)
      return query.order("product_id").order("warehouse_id").range(from, to)
    }),
    readAll((from, to) => db.from("vendors").select("id,name,active").eq("org_id", ctx.orgId).order("id").range(from, to)),
  ])
  const stocks = checked(balances)
  const byProduct = new Map<string, Tables<"stock_on_hand">[]>()
  for (const balance of stocks) {
    const rows = byProduct.get(balance.product_id) ?? []
    rows.push(balance)
    byProduct.set(balance.product_id, rows)
  }
  return {
    products: checked(products).filter(p => !productId || p.id === productId).map(product => {
      const rows = byProduct.get(product.id) ?? []
      return { ...product, quantity: Math.round(rows.reduce((sum, row) => sum + row.quantity, 0) * 1000) / 1000, value_satang: sumSatang(rows.map(row => row.value_satang)) }
    }),
    warehouses: checked(warehouses), vendors: checked(vendors), balances: stocks,
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

export async function invoiceStockableCount(invoiceId: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const { count, error } = await db.from("invoice_items").select("id,products!inner(is_stockable)", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("invoice_id", invoiceId).eq("products.is_stockable", true)
  if (error) throw new Error("Invoice stockable lines unavailable")
  return count ?? 0
}
