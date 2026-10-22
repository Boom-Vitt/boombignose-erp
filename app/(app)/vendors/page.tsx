import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { parseFacets, matchesFacets, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { monthKey } from "@/lib/dates"
import { PageHeader } from "@/components/page-header"
import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export default async function VendorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrgContext()
  const config = parseFacets(await searchParams, "vendors")
  const db = await createClient()
  const [vendors, savedViews] = await Promise.all([
    readAllOrThrow((from, to) => db.from("vendors").select("*").eq("org_id", ctx.orgId).order("name").order("id").range(from, to)),
    getFacetSavedViews("vendors"),
  ])
  const rows = vendors.filter(v => matchesFacets(config, { text: `${v.name} ${v.tax_id ?? ""} ${v.email ?? ""}`, status: v.active ? "active" : "archived", date: v.created_at, owner: null }, ctx.userId))
  return <div className="space-y-6">
    <PageHeader title="Vendors" description="Supplier details, purchase orders and outstanding bills.">{can(ctx.role, "purchase:manage") && <Button render={<Link href="/vendors/new" />}>New vendor</Button>}</PageHeader>
    <SearchFacets list="vendors" config={config} savedViews={savedViews} />
    {!rows.length ? <p className="rounded-xl border p-6 text-muted-foreground">No matching vendors.</p> : <Table>
      <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Terms</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody><GroupedTableRows rows={rows} colSpan={5} group={config.groupBy ? v => config.groupBy === "month" ? { key: monthKey(v.created_at), label: monthKey(v.created_at) } : { key: String(v.active), label: v.active ? "Active" : "Archived" } : undefined}>
        {v => <TableRow key={v.id}><TableCell><Link className="font-medium hover:underline" href={`/vendors/${v.id}`}>{v.name}</Link></TableCell><TableCell>{v.email ?? "—"}</TableCell><TableCell>{v.phone ?? "—"}</TableCell><TableCell>{v.payment_terms_days} days</TableCell><TableCell>{v.active ? "Active" : "Archived"}</TableCell></TableRow>}
      </GroupedTableRows></TableBody>
    </Table>}
  </div>
}
