"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { updateBusinessProfile } from "../actions"

export function BusinessProfileForm({ initial }: { initial: { legalName: string; address: string; taxId: string; taxStatus: "unknown" | "not_registered" | "registered" } }) {
  const [value, setValue] = useState(initial)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const result = await updateBusinessProfile(value)
        if (result.error) { toast.error(result.error); return }
        toast.success("บันทึกข้อมูลกิจการแล้ว / Business profile saved")
        router.refresh()
      } catch { toast.error("Could not confirm the profile update. Reload and check before retrying.") }
    })
  }}>
    <label className="block text-sm">ชื่อกิจการตามเอกสาร / Legal business name<Input required maxLength={200} value={value.legalName} onChange={event => setValue({ ...value, legalName: event.target.value })} disabled={pending} /></label>
    <label className="block text-sm">ที่อยู่กิจการ / Business address<Textarea required maxLength={2000} value={value.address} onChange={event => setValue({ ...value, address: event.target.value })} disabled={pending} /></label>
    <label className="block text-sm">เลขประจำตัวผู้เสียภาษี / Tax ID<Input maxLength={30} value={value.taxId} onChange={event => setValue({ ...value, taxId: event.target.value })} disabled={pending} /></label>
    <label className="block text-sm">สถานะ VAT / VAT registration status<select className="mt-1 block w-full rounded border bg-background p-2" value={value.taxStatus} disabled={pending} onChange={event => setValue({ ...value, taxStatus: event.target.value as typeof value.taxStatus })}><option value="unknown">ยังไม่ยืนยัน / Unknown</option><option value="not_registered">ไม่จดทะเบียน / Not registered</option><option value="registered">จดทะเบียน / Registered</option></select></label>
    <p className="text-sm text-muted-foreground">ข้อมูลนี้เก็บไว้ในเอกสารที่ออกแต่ละครั้ง / Issued documents retain their own copy of this profile. This operational invoice workflow does not calculate VAT or certify a tax invoice. Confirm treatment with your accountant.</p>
    <Button type="submit" disabled={pending}>Save business profile</Button>
  </form>
}
