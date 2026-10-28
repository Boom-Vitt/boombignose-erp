"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { TaxInvoiceTemplateInput } from "@/lib/tax/invoice-checklist"
import { saveTaxInvoiceTemplate } from "../actions"

export function TaxInvoiceTemplateForm({ orgId, initial }: { orgId: string; initial: TaxInvoiceTemplateInput }) {
  const [value, setValue] = useState(initial)
  const [pending, start] = useTransition()
  const router = useRouter()
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    start(async () => {
      const result = await saveTaxInvoiceTemplate({ expectedOrgId: orgId, ...value })
      if (result.error) { toast.error(result.error); return }
      toast.success("Optional tax-invoice fields saved. The document is still operational.")
      router.refresh()
    })
  }}>
    <h2 className="text-sm font-medium">Optional tax-invoice fields</h2>
    <p className="text-sm text-muted-foreground">These stay on the workspace. They are not copied onto issued invoices, and saving them does not create a statutory tax invoice.</p>
    <label className="block text-sm">โทรศัพท์ผู้ขาย / Seller phone<Input maxLength={40} value={value.seller_phone} disabled={pending} onChange={event => setValue({ ...value, seller_phone: event.target.value })} /></label>
    <label className="block text-sm">รหัสสาขา 5 หลัก / Branch code<Input maxLength={5} inputMode="numeric" value={value.branch_code} disabled={pending} onChange={event => setValue({ ...value, branch_code: event.target.value })} placeholder="00000" /></label>
    <label className="block text-sm">ต้นฉบับหรือสำเนา / Original or copy label<Input maxLength={40} value={value.copy_label} disabled={pending} onChange={event => setValue({ ...value, copy_label: event.target.value })} placeholder="ต้นฉบับ" /></label>
    <Button type="submit" disabled={pending}>Save optional fields</Button>
  </form>
}
