import Link from "next/link"
import { z } from "zod"
import { inventoryData } from "@/lib/inventory/queries"
import { formatTHB, sumSatang } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SearchParams } from "@/lib/search-facets"

export const dynamic = "force-dynamic"

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const warehouse = z.guid().safeParse(params.warehouse).data
  const product = z.guid().safeParse(params.product).data
  const { products, warehouses } = await inventoryData(warehouse, product)
  return <div className="space-y-6">
    <PageHeader title="Inventory" description="On hand and perpetual moving-average stock value." />
    <form className="flex flex-wrap items-end gap-3"><div><Label htmlFor="warehouse-filter">Warehouse</Label><select key={warehouse ?? "all"} id="warehouse-filter" name="warehouse" defaultValue={warehouse ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">All warehouses</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}{w.active ? "" : " (inactive)"}</option>)}</select></div>{product && <input name="product" type="hidden" value={product} />}<Button type="submit" variant="outline">Apply</Button>{product && <Link href="/inventory">All products</Link>}</form>
    <p className="font-semibold">Stock value: {formatTHB(sumSatang(products.map(p => p.value_satang)))}</p>
    <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>On hand</TableHead><TableHead>Minimum</TableHead><TableHead>Stock value</TableHead><TableHead>Moves</TableHead></TableRow></TableHeader><TableBody>{products.map(p => <TableRow key={p.id}><TableCell><Link className="underline" href={`/products/${p.id}`}>{p.name}</Link>{p.quantity < p.reorder_min && <Badge variant="destructive" className="ml-2">Low stock</Badge>}</TableCell><TableCell>{p.sku ?? "—"}</TableCell><TableCell data-testid={`on-hand-${p.id}`}>{p.quantity} {p.unit}</TableCell><TableCell>{p.reorder_min}</TableCell><TableCell>{formatTHB(p.value_satang)}</TableCell><TableCell><Link className="underline" href={`/inventory/moves?product=${p.id}${warehouse ? `&warehouse=${warehouse}` : ""}`}>Moves</Link></TableCell></TableRow>)}</TableBody></Table>
    {!products.length && <p>No stockable products. Enable Stockable when creating a goods product in the catalog.</p>}
    <p className="text-sm text-muted-foreground">Receipts update the weighted average of remaining stock. Deliveries use that cost. Values are rounded to whole satang for display.</p>
  </div>
}
