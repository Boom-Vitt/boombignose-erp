import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { inventoryData } from "@/lib/inventory/queries"
import { signedQuantity } from "@/lib/inventory/math"
import { facetLabel, facetValues, parseFacets, serializeFacets, type SearchParams } from "@/lib/search-facets"
import { periodRange } from "@/lib/periods"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { SearchFacets } from "@/components/search/search-facets"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export default async function StockMovesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrgContext()
  const params = await searchParams
  const config = parseFacets(params, "inventory")
  const before = typeof params.before === "string" && /^[1-9][0-9]*$/.test(params.before) && Number.isSafeInteger(Number(params.before)) ? Number(params.before) : undefined
  const range = config.period ? periodRange(config.period) : undefined
  const db = await createClient()
  const [{ products, warehouses }, views, result] = await Promise.all([
    inventoryData(), getFacetSavedViews("inventory"),
    db.rpc("stock_moves_page", {
      p_org_id: ctx.orgId, p_before: before,
      p_kinds: config.status ? facetValues(config.status) : undefined,
      p_warehouse_id: config.warehouse, p_product_id: config.product, p_source_id: config.sourceId,
      p_actor_id: config.mine ? ctx.userId : undefined,
      p_start: range ? `${range.start}T00:00:00+07:00` : undefined,
      p_end: range ? `${range.end}T00:00:00+07:00` : undefined, p_query: config.q,
    }),
  ])
  if (result.error || !result.data) throw new Error("Stock ledger unavailable")
  const productNames = new Map(products.map(p => [p.id, p.name]))
  const warehouseNames = new Map(warehouses.map(w => [w.id, w.code]))
  const moves = result.data.slice(0, 100)
  const older = result.data.length > 100 ? `/inventory/moves?${serializeFacets(config, "inventory")}&before=${moves.at(-1)!.sequence}` : null
  return <div className="space-y-6"><PageHeader title="Stock moves" description="Append-only stock ledger. Correct mistakes with a new count adjustment." />
    <SearchFacets list="inventory" config={config} savedViews={views} selectors={[{ key: "warehouse", label: "Warehouse", options: warehouses }, { key: "product", label: "Product", options: products }]} />
    <p className="text-sm text-muted-foreground">{moves.length} moves on this page</p>
    <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Warehouse</TableHead><TableHead>Kind</TableHead><TableHead>Quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>Balance after</TableHead><TableHead>Source / reason</TableHead></TableRow></TableHeader><TableBody>{moves.map(m => <TableRow key={m.id}><TableCell>{new Date(m.moved_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}</TableCell><TableCell><Link className="underline" href={`/products/${m.product_id}`}>{productNames.get(m.product_id)}</Link></TableCell><TableCell>{warehouseNames.get(m.warehouse_id)}</TableCell><TableCell>{facetLabel(m.kind)}</TableCell><TableCell>{signedQuantity(m.kind, m.quantity)}</TableCell><TableCell>{formatTHB(m.unit_cost_satang)}</TableCell><TableCell>{m.balance_after}</TableCell><TableCell>{m.source_type === "invoice" || m.source_type === "purchase_order" ? <Link className="underline" href={m.source_type === "invoice" ? `/finance/invoices/${m.source_id}` : `/purchases/${m.source_id}`}>{m.note ?? m.source_type}</Link> : m.note}</TableCell></TableRow>)}</TableBody></Table>
    <nav aria-label="Stock move pages" className="flex gap-4">{before && <Link className="underline" href={`/inventory/moves?${serializeFacets(config, "inventory")}`}>Latest moves</Link>}{older && <Link className="underline" href={older}>Older moves</Link>}</nav>
    {!moves.length && <p>No moves match these filters.</p>}
  </div>
}
