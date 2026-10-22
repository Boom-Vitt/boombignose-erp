import Link from "next/link"
import { notFound } from "next/navigation"
import { z } from "zod"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { serviceAmountBaht } from "@/lib/workflows/service"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ProductForm } from "../../_components/product-form"

export const dynamic = "force-dynamic"

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOrgContext()
  requireCapability(ctx, "product:manage")
  if (!z.uuid().safeParse(id).success) notFound()
  const supabase = await createClient()
  const { data: product, error } = await supabase.from("products").select("*").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!product) notFound()
  return <div className="space-y-6">
    <PageHeader title="Edit product" description="Changes apply to future line selections."><Button variant="outline" render={<Link href={`/products/${id}`} />}>Back to product</Button></PageHeader>
    <Card className="max-w-2xl"><CardContent><ProductForm id={id} defaults={{
      name: product.name, sku: product.sku ?? "", description: product.description ?? "", type: product.type,
      unit: product.unit, listPriceBaht: serviceAmountBaht(product.list_price_satang), costBaht: serviceAmountBaht(product.cost_satang),
      taxRateBps: product.tax_rate_bps, isStockable: product.is_stockable,
    }} /></CardContent></Card>
  </div>
}
