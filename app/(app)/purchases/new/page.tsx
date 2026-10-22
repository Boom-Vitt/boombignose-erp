import Link from "next/link"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { purchaseOptions } from "@/lib/purchasing/queries"
import { todayISO } from "@/lib/dates"
import { PageHeader } from "@/components/page-header"
import { PurchaseForm } from "../_components/purchase-form"

export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<{ vendor?: string }> }) {
  requireCapability(await requireOrgContext(), "purchase:manage")
  const { vendors } = await purchaseOptions()
  return <div className="space-y-6"><PageHeader title="New purchase order" description="Create a draft RFQ, then add product lines." />
    {!vendors.length && <p><Link className="underline" href="/vendors/new">Create a vendor first</Link>.</p>}
    <PurchaseForm vendors={vendors} today={todayISO()} vendorId={(await searchParams).vendor} />
  </div>
}
