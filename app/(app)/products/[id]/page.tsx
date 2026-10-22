import Link from "next/link"
import { notFound } from "next/navigation"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ArchiveProductButton } from "../_components/archive-product-button"

export const dynamic = "force-dynamic"

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOrgContext()
  if (!z.guid().safeParse(id).success) notFound()
  const supabase = await createClient()
  const { data: product, error } = await supabase.from("products").select("*").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!product) notFound()
  return <div className="space-y-6">
    <PageHeader title={product.name} description="Catalog defaults for future line items.">
      <Button variant="outline" render={<Link href="/products" />}>Back to products</Button>
      {can(ctx.role, "product:manage") && <><ArchiveProductButton id={id} active={product.active} /><Button render={<Link href={`/products/${id}/edit`} />}>Edit product</Button></>}
    </PageHeader>
    <Card className="max-w-2xl"><CardContent className="space-y-5">
      <Badge variant={product.active ? "secondary" : "outline"}>{product.active ? "Active" : "Archived"}</Badge>
      <dl className="grid gap-4 sm:grid-cols-2">
        {Object.entries({ SKU: product.sku ?? "—", Type: product.type === "service" ? "Service" : "Goods", Unit: product.unit, "Sales price": formatTHB(product.list_price_satang), Cost: formatTHB(product.cost_satang), "Tax rate": `${product.tax_rate_bps} basis points (stored for future use)`, Stockable: product.is_stockable ? "Yes" : "No" }).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm">{value}</dd></div>)}
      </dl>
      <p className="whitespace-pre-wrap text-sm">{product.description ?? "No line description. New lines use the product name."}</p>
      <p className="text-xs text-muted-foreground">Archiving hides this product from new selections. Saved quote and invoice lines keep their descriptions, units and prices.</p>
    </CardContent></Card>
  </div>
}
