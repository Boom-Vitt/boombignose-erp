import Link from "next/link"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ProductForm } from "../_components/product-form"

export const dynamic = "force-dynamic"

export default async function NewProductPage() {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "product:manage")
  return <div className="space-y-6">
    <PageHeader title="New product" description="Set defaults for future quote and invoice lines."><Button variant="outline" render={<Link href="/products" />}>Back to products</Button></PageHeader>
    <Card className="max-w-2xl"><CardContent><ProductForm /></CardContent></Card>
  </div>
}
