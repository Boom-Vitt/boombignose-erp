import Link from "next/link"
import { Package, Plus } from "lucide-react"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProductsToolbar } from "./_components/products-toolbar"

export const dynamic = "force-dynamic"

export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const ctx = await requireOrgContext()
  const params = await searchParams
  const search = (params.q ?? "").trim().slice(0, 200)
  const status = params.status === "archived" ? "archived" : params.status === "all" ? "all" : "active"
  const supabase = await createClient()
  let query = supabase.from("products").select("id, sku, name, type, unit, list_price_satang, active")
    .eq("org_id", ctx.orgId).order("name")
  if (status !== "all") query = query.eq("active", status === "active")
  if (search) {
    const pattern = JSON.stringify(`%${search.replace(/[\\%_]/g, "\\$&")}%`)
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`)
  }
  const { data: products, error } = await query
  if (error) throw new Error(error.message)
  return (
    <div className="space-y-6">
      <PageHeader title="Products" description="Products and services with reusable prices and units.">
        {can(ctx.role, "product:manage") && <Button render={<Link href="/products/new" />}><Plus /> New product</Button>}
      </PageHeader>
      <ProductsToolbar key={`${search}-${status}`} search={search} status={status} />
      {products.length === 0 ? <EmptyState icon={Package} title="No products found" description="Create a product or adjust your search and status filter." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>SKU</TableHead><TableHead>Type</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Sales price</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{products.map(product => <TableRow key={product.id}>
            <TableCell><Link href={`/products/${product.id}`} className="font-medium hover:underline">{product.name}</Link></TableCell>
            <TableCell>{product.sku ?? "—"}</TableCell><TableCell>{product.type === "service" ? "Service" : "Goods"}</TableCell><TableCell>{product.unit}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(product.list_price_satang)}</TableCell><TableCell><Badge variant={product.active ? "secondary" : "outline"}>{product.active ? "Active" : "Archived"}</Badge></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}
    </div>
  )
}
