import Link from "next/link"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { purchaseTotal } from "@/lib/purchasing/quantities"
import { parseFacets, matchesFacets, facetLabel, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { monthKey } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrgContext()
  const params = await searchParams
  const config = parseFacets(params, "purchases")
  const vendorId = z.uuid().safeParse(params.vendor)
  const db = await createClient()
  const [orders, lines, savedViews] = await Promise.all([
    readAllOrThrow((from, to) => db.from("purchase_orders").select("*,vendors(name)").eq("org_id", ctx.orgId).order("order_date", { ascending: false }).order("id").range(from, to)),
    readAllOrThrow((from, to) => db.from("purchase_order_items").select("purchase_order_id,quantity,unit_cost_satang").eq("org_id", ctx.orgId).order("id").range(from, to)),
    getFacetSavedViews("purchases"),
  ])
  const byOrder = new Map<string, typeof lines>()
  for (const line of lines) {
    if (!byOrder.has(line.purchase_order_id)) byOrder.set(line.purchase_order_id, [])
    byOrder.get(line.purchase_order_id)!.push(line)
  }
  const rows = orders.filter(po => (!vendorId.success || po.vendor_id === vendorId.data) && matchesFacets(config, { text: `${po.number} ${po.vendors?.name ?? ""}`, status: po.status, date: po.order_date, owner: po.created_by }, ctx.userId)).map(po => ({ ...po, total: purchaseTotal(byOrder.get(po.id) ?? []) }))
  return <div className="space-y-6">
    <PageHeader title="Purchases" description="Request quotations, receive products and create vendor bills.">{can(ctx.role, "purchase:manage") && <Button render={<Link href="/purchases/new" />}>New purchase order</Button>}</PageHeader>
    {vendorId.success && <p className="text-sm">Showing this vendor’s orders. <Link href="/purchases" className="underline">Show all vendors</Link></p>}
    <SearchFacets list="purchases" config={config} savedViews={savedViews} />
    {!rows.length ? <p className="rounded-xl border p-6 text-muted-foreground">No matching purchase orders.</p> : <Table>
      <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Vendor</TableHead><TableHead>Status</TableHead><TableHead>Order date</TableHead><TableHead>Expected</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
      <TableBody><GroupedTableRows rows={rows} colSpan={6} amount={po => po.total} group={config.groupBy ? po => config.groupBy === "vendor" ? { key: po.vendor_id, label: po.vendors?.name ?? "Vendor" } : config.groupBy === "month" ? { key: monthKey(po.order_date), label: monthKey(po.order_date) } : { key: po.status, label: facetLabel(po.status) } : undefined}>
        {po => <TableRow key={po.id}><TableCell><Link className="font-medium hover:underline" href={`/purchases/${po.id}`}>{po.number}</Link></TableCell><TableCell><Link className="hover:underline" href={`/vendors/${po.vendor_id}`}>{po.vendors?.name}</Link></TableCell><TableCell><StatusBadge status={po.status} /></TableCell><TableCell>{po.order_date}</TableCell><TableCell>{po.expected_date ?? "—"}</TableCell><TableCell className="text-right">{formatTHB(po.total)}</TableCell></TableRow>}
      </GroupedTableRows></TableBody>
    </Table>}
  </div>
}
