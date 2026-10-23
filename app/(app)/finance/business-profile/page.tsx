import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BusinessProfileForm } from "../_components/business-profile-form"
export const dynamic = "force-dynamic"
export default async function BusinessProfilePage() {
  const ctx = await requireOrgContext()
  if (ctx.role === "member") return <p>Only owners and admins can manage the business profile.</p>
  const supabase = await createClient()
  const { data, error } = await supabase.from("org_settings").select("legal_name, business_address, tax_id, tax_status, vat_registered, vat_rate_bps, prices_include_vat, branch_label").eq("org_id", ctx.orgId).maybeSingle()
  if (error) throw new Error("Business profile unavailable")
  const taxStatus = data?.tax_status
  return <div className="space-y-6"><PageHeader title="ข้อมูลกิจการ / Business profile" description="Prepare the issuer details before issuing an operational invoice."><Button variant="outline" render={<Link href="/finance" />}>Back to finance</Button></PageHeader><Card className="max-w-3xl"><CardContent><BusinessProfileForm orgId={ctx.orgId} initial={{ vatRateBps: data?.vat_rate_bps ?? 700, pricesIncludeVat: data?.prices_include_vat ?? false, branchLabel: data?.branch_label ?? "", legalName: data?.legal_name ?? "", address: data?.business_address ?? "", taxId: data?.tax_id ?? "", taxStatus: taxStatus === "registered" || taxStatus === "not_registered" ? taxStatus : "unknown" }} /></CardContent></Card></div>
}
