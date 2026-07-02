import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { requireOrgContext } from "@/lib/auth"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { createProduct } from "../actions"
import {
  ProductForm,
  type ProductFormValues,
} from "../_components/product-form"

export const dynamic = "force-dynamic"

export default async function NewProductPage() {
  await requireOrgContext()

  const defaultValues: ProductFormValues = {
    name: "",
    description: "",
    kind: "service",
    unitPriceBaht: 0,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New catalog item"
        description="Add a product or service to reuse on quotes and invoices."
      >
        <Button variant="outline" render={<Link href="/products" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-3xl">
        <CardContent>
          <ProductForm
            defaultValues={defaultValues}
            submitLabel="Create item"
            action={createProduct}
          />
        </CardContent>
      </Card>
    </div>
  )
}
