import Link from "next/link"
import { ShoppingCart, Receipt, Coins } from "lucide-react"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { vendorDetail } from "@/lib/purchasing/queries"
import { formatTHB, sumSatang } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { SmartButtons } from "@/components/record/smart-buttons"
import { RecordHistory } from "@/components/record/record-history"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { VendorBills } from "../../purchases/_components/bills"

export const dynamic = "force-dynamic"
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const { vendor, orders, bills } = await vendorDetail(id)
  const manage = can(ctx.role, "purchase:manage")
  const open = bills.filter(b => !b.paid_at)
  return <div className="space-y-6">
    <PageHeader title={vendor.name} description={vendor.active ? "Vendor" : "Archived vendor"}>
      {manage && <><Button variant="outline" render={<Link href={`/vendors/${id}/edit`} />}>Edit vendor</Button>{vendor.active && <Button render={<Link href={`/purchases/new?vendor=${id}`} />}>New purchase order</Button>}</>}
    </PageHeader>
    <SmartButtons buttons={[
      { label: "Purchase orders", icon: ShoppingCart, href: `/purchases?vendor=${id}`, count: orders.length, nextStep: true },
      { label: "Open bills", icon: Receipt, href: "#bills", count: open.length, nextStep: true },
      { label: "Amount owed", icon: Coins, href: "#bills", count: open.length, value: formatTHB(sumSatang(open.map(b => b.amount_satang))), nextStep: true },
    ]} />
    <dl className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
      {[["Tax ID", vendor.tax_id], ["Email", vendor.email], ["Phone", vendor.phone], ["Address", vendor.address], ["Payment terms", `${vendor.payment_terms_days} days`], ["Notes", vendor.notes]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap">{value || "—"}</dd></div>)}
    </dl>
    <section className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Purchase orders ({orders.length})</h2>{orders.length ? <ul className="divide-y">{orders.map(po => <li key={po.id} className="flex items-center justify-between gap-3 py-2"><Link className="underline" href={`/purchases/${po.id}`}>{po.number}</Link><StatusBadge status={po.status} /></li>)}</ul> : <p className="text-sm text-muted-foreground">No purchase orders yet.</p>}</section>
    <VendorBills bills={bills} canManage={manage} />
    <RecordHistory recordType="vendor" recordId={id} />
  </div>
}
