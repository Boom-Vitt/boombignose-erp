import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import { inventoryData } from "@/lib/inventory/queries"
import type { Enums } from "@/lib/types/database"
import { signedQuantity } from "@/lib/inventory/math"
import { facetLabel, parseFacets, type SearchParams } from "@/lib/search-facets"
import { periodRange } from "@/lib/periods"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { SearchFacets } from "@/components/search/search-facets"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export default async function StockMovesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrgContext()
  const config = parseFacets(await searchParams, "inventory")
  const db = await createClient()
  const [{ products, warehouses }, views, result] = await Promise.all([
    inventoryData(), getFacetSavedViews("inventory"),
    readAll((from, to) => {
      let query = db.from("stock_moves").select("*").eq("org_id", ctx.orgId)
      if (config.status) query = query.eq("kind", config.status as Enums<"stock_move_kind">)
      if (config.warehouse) query = query.eq("warehouse_id", config.warehouse)
      if (config.product) query = query.eq("product_id", config.product)
      if (config.sourceId) query = query.eq("source_id", config.sourceId)
      if (config.mine) query = query.eq("created_by", ctx.userId)
      if (config.period) {
        const { start, end } = periodRange(config.period)
        query = query.gte("moved_at", `${start}T00:00:00+07:00`).lt("moved_at", `${end}T00:00:00+07:00`)
      }
      return query.order("sequence", { ascending: false }).range(from, to)
    }),
  ])
  if (result.error || !result.data) throw new Error("Stock ledger unavailable")
  const productNames = new Map(products.map(p => [p.id, p.name]))
  const warehouseNames = new Map(warehouses.map(w => [w.id, w.code]))
  const moves = result.data.filter(m => !config.q || `${productNames.get(m.product_id)} ${warehouseNames.get(m.warehouse_id)} ${m.note ?? ""}`.toLowerCase().includes(config.q.toLowerCase()))
  return <div className="space-y-6"><PageHeader title="Stock moves" description="Append-only stock ledger. Correct mistakes with a new count adjustment." />
    <SearchFacets list="inventory" config={config} savedViews={views} selectors={[{ key: "warehouse", label: "Warehouse", options: warehouses }, { key: "product", label: "Product", options: products }]} />
    <p className="text-sm text-muted-foreground">{moves.length} moves</p>
    <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Warehouse</TableHead><TableHead>Kind</TableHead><TableHead>Quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>Balance after</TableHead><TableHead>Source / reason</TableHead></TableRow></TableHeader><TableBody>{moves.map(m => <TableRow key={m.id}><TableCell>{new Date(m.moved_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}</TableCell><TableCell><Link className="underline" href={`/products/${m.product_id}`}>{productNames.get(m.product_id)}</Link></TableCell><TableCell>{warehouseNames.get(m.warehouse_id)}</TableCell><TableCell>{facetLabel(m.kind)}</TableCell><TableCell>{signedQuantity(m.kind, m.quantity)}</TableCell><TableCell>{formatTHB(m.unit_cost_satang)}</TableCell><TableCell>{m.balance_after}</TableCell><TableCell>{m.source_type === "invoice" || m.source_type === "purchase_order" ? <Link className="underline" href={m.source_type === "invoice" ? `/finance/invoices/${m.source_id}` : `/purchases/${m.source_id}`}>{m.note ?? m.source_type}</Link> : m.note}</TableCell></TableRow>)}</TableBody></Table>
    {!moves.length && <p>No moves match these filters.</p>}
  </div>
}
