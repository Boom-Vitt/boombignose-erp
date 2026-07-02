import Link from "next/link"
import { Package, PackagePlus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB } from "@/lib/money"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

export const dynamic = "force-dynamic"

const KIND_LABEL: Record<"service" | "good", string> = {
  service: "Service",
  good: "Good",
}

export default async function ProductsPage() {
  await requireOrgContext()
  const supabase = await createClient()

  const { data } = await supabase
    .from("products")
    .select("id, name, kind, unit_price_satang, active")
    .order("active", { ascending: false })
    .order("name", { ascending: true })

  const products = data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog"
        description="Reusable products and services to speed up quote and invoice line items."
      >
        <Button render={<Link href="/products/new" />}>
          <PackagePlus /> New item
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products &amp; services</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No catalog items yet"
              description="Add products or services to prefill line items on quotes and invoices."
              action={
                <Button render={<Link href="/products/new" />}>
                  <PackagePlus /> New item
                </Button>
              }
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link href={`/products/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{KIND_LABEL[p.kind]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(p.unit_price_satang)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.active ? "secondary" : "outline"}>
                        {p.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
