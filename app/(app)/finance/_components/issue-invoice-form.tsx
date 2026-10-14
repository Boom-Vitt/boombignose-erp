"use client"
import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { issueInvoice } from "../actions"

export function IssueInvoiceForm({ orgId, invoiceId, version }: { orgId: string; invoiceId: string; version: number }) {
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()
  const request = useRef<string | null>(null)
  const router = useRouter()
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">ออกใบแจ้งหนี้เพื่อการดำเนินงาน / Issuance freezes this version’s issuer, buyer, priced lines, discount and dates. It does not calculate VAT or create a tax invoice.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />I checked the business profile, buyer, lines, discount and dates.</label><Button disabled={!confirmed || pending} onClick={() => {
    if (!request.current) {
      try { request.current = paymentCommandKey(sessionStorage, `${orgId}/${invoiceId}/issue`, [String(version)], () => crypto.randomUUID()) }
      catch { request.current = crypto.randomUUID() }
    }
    const key = request.current
    startTransition(async () => {
      try {
        const result = await issueInvoice({ invoiceId, expectedVersion: version, key })
        if (result.error) { toast.error(result.error); return }
        toast.success("ออกเอกสารแล้ว / Operational invoice issued")
        router.refresh()
      } catch { toast.error("Could not confirm the issue response. Retry unchanged details to recover the original result.") }
    })
  }}>Issue operational invoice</Button></div>
}
