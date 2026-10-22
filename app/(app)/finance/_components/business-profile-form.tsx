"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { updateBusinessProfile } from "../actions"

export function BusinessProfileForm({ orgId, initial }: { orgId: string; initial: { legalName: string; address: string; taxId: string; taxStatus: "unknown" | "not_registered" | "registered"; vatRegistered: boolean; vatRateBps: number; pricesIncludeVat: boolean; branchLabel: string } }) {
  const [value, setValue] = useState(initial)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const result = await updateBusinessProfile({ ...value, expectedOrgId: orgId })
        if (result.error) { toast.error(result.error); return }
        toast.success("บันทึกข้อมูลกิจการแล้ว / Business profile saved")
        router.refresh()
      } catch { toast.error("Could not confirm the profile update. Reload and check before retrying.") }
    })
  }}>
    <label className="block text-sm">ชื่อกิจการตามเอกสาร / Legal business name<Input required maxLength={200} value={value.legalName} onChange={event => setValue({ ...value, legalName: event.target.value })} disabled={pending} /></label>
    <label className="block text-sm">ที่อยู่กิจการ / Business address<Textarea required maxLength={1000} value={value.address} onChange={event => setValue({ ...value, address: event.target.value })} disabled={pending} /></label>
    <label className="block text-sm">เลขประจำตัวผู้เสียภาษี / Tax ID<Input maxLength={13} value={value.taxId} onChange={event => setValue({ ...value, taxId: event.target.value })} disabled={pending} /></label>

    <p className="text-sm text-muted-foreground">ข้อมูลนี้เก็บไว้ในเอกสารที่ออกแต่ละครั้ง / Issued documents retain their own copy of this profile. Review tax treatment with your accountant.</p>
    <label className="block text-sm">Branch<Input maxLength={200} value={value.branchLabel} onChange={event => setValue({ ...value, branchLabel: event.target.value })} disabled={pending} placeholder="Head office" /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.vatRegistered} disabled={pending} onChange={event => setValue({ ...value, vatRegistered: event.target.checked, taxStatus: event.target.checked ? "registered" : "not_registered" })} />VAT registered</label>
    <label className="block text-sm">Default VAT rate (bps)<Input type="number" min={0} max={10000} step={1} value={value.vatRateBps} onChange={event => setValue({ ...value, vatRateBps: Number(event.target.value) })} disabled={pending} />700 = 7%</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.pricesIncludeVat} disabled={pending} onChange={event => setValue({ ...value, pricesIncludeVat: event.target.checked })} />Prices include VAT for new documents</label>
    <p className="text-xs text-muted-foreground">VAT and withholding are document calculations only. This is not a legal tax system, accounting ledger, tax filing service or e-Tax Invoice. Review documents with your accountant.</p>
    <Button type="submit" disabled={pending}>Save business profile</Button>
  </form>
}
