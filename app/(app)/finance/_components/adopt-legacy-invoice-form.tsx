"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { adoptLegacyInvoice } from "../actions"

export function AdoptLegacyInvoiceForm({ orgId, invoiceId, version }: { orgId: string; invoiceId: string; version: number }) {
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()
  const command = useRef<{ details: string; key: string } | null>(null)
  const router = useRouter()
  const scope = `${orgId}/${invoiceId}/adopt-legacy`
  const trimmedReason = reason.trim()

  function submit() {
    if (pending || !confirmed || !trimmedReason || trimmedReason.length > 1000) return
    const details = JSON.stringify([scope, String(version), trimmedReason])
    if (command.current?.details !== details) {
      let key: string
      try { key = paymentCommandKey(sessionStorage, scope, [String(version), trimmedReason], () => crypto.randomUUID()) }
      catch { key = crypto.randomUUID() }
      command.current = { details, key }
    }
    const key = command.current.key
    startTransition(async () => {
      try {
        const result = await adoptLegacyInvoice({ invoiceId, expectedVersion: version, key, reason: trimmedReason })
        if (result.error) { toast.error(result.error); return }
        toast.success("Legacy invoice adopted")
        router.refresh()
      } catch { toast.error("Could not confirm adoption. Retry unchanged details to recover the original result.") }
    })
  }

  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit() }}>
    <p className="text-sm text-muted-foreground">Adoption freezes the existing invoice number, dates, header and lines. It captures the current business and buyer profiles now. It does not reissue the invoice or create a receipt.</p>
    <label className="block text-sm">Adoption reason
      <Textarea value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} disabled={pending} />
    </label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={pending} />I reviewed the original invoice and current profiles and confirm this snapshot.</label>
    <Button type="submit" disabled={pending || !confirmed || !trimmedReason || trimmedReason.length > 1000}>{pending ? "Adopting…" : "Adopt legacy invoice"}</Button>
  </form>
}
