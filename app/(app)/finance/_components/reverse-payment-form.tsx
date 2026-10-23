"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { reversePayment } from "../correction-actions"

export function ReversePaymentForm({ orgId, invoiceId, paymentId, today }: { orgId: string; invoiceId?: string; paymentId: string; today: string }) {
  const [reason, setReason] = useState("")
  const [date, setDate] = useState(today)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-2 mt-2" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const key = paymentCommandKey(sessionStorage, `${orgId}/${paymentId}/reverse`, [reason, date], () => crypto.randomUUID())
        const result = await reversePayment({ paymentId, invoiceId, key, reason, reversedOn: date })
        if (result.error) { toast.error(result.error); return }
        toast.success("Receipt reversed"); router.refresh()
      } catch { toast.error("Could not confirm reversal. Retry unchanged details.") }
    })
  }}><label>Reversal reason<Input disabled={pending} required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <label>Reversal date<Input disabled={pending} required type="date" max={today} value={date} onChange={event => setDate(event.target.value)} /></label>
    <Button type="submit" variant="outline" disabled={pending}>Reverse receipt</Button>
  </form>
}
