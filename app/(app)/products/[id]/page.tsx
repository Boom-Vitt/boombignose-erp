import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { updateProduct } from "../actions"
import {
  ProductForm,
  type ProductFormValues,
  type ProductFormSubmitValues,
} from "../_components/product-form"
import { ProductActiveButton } from "../_components/product-active-button"
import { DeleteProductButton } from "../_components/delete-product-button"

export const dynamic = "force-dynamic"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireOrgContext()
  const supabase = await createClient()

  const { data: product } = await supabase
    .from("products")
    .select("id, name, description, kind, unit_price_satang, active")
    .eq("id", id)
    .maybeSingle()

  if (!product) notFound()

  const defaultValues: ProductFormValues = {
    name: product.name,
    description: product.description ?? "",
    kind: product.kind,
    unitPriceBaht: satangToBaht(product.unit_price_satang),
  }

  // Bind the product id into a real server action (see quotes/[id] for why a
  // plain closure can't cross the RSC boundary to a "use client" form).
  const productId = product.id
  async function saveProduct(values: ProductFormSubmitValues) {
    "use server"
    return updateProduct({ id: productId, ...values })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={product.kind === "service" ? "Service" : "Good"}
      >
        <Button variant="outline" render={<Link href="/products" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-3xl">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Edit item</CardTitle>
          <Badge variant={product.active ? "secondary" : "outline"}>
            {product.active ? "Active" : "Inactive"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <ProductForm
            defaultValues={defaultValues}
            submitLabel="Save changes"
            action={saveProduct}
          />

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <ProductActiveButton id={product.id} active={product.active} />
            <DeleteProductButton id={product.id} name={product.name} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
