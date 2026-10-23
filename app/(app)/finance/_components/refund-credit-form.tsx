"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { financialCommandKey, completePaymentCommand } from "@/lib/payments/retry-command"
import { refundCustomerCredit } from "../receipt-actions"
import type { Enums } from "@/lib/types/database"

export function RefundCreditForm({ orgId, paymentId, today }: { orgId: string; paymentId: string; today: string }) {
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [date, setDate] = useState(today)
  const [method, setMethod] = useState<Enums<"payment_method">>("transfer")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-2" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const key = financialCommandKey(sessionStorage, `${orgId}/${paymentId}/refund`, [amount, reference, date, method], () => crypto.randomUUID())
        const result = await refundCustomerCredit({ paymentId, amountBaht: amount, reference, paidOn: date, method, key })
        if (result.error) { toast.error(result.error); return }
        completePaymentCommand(sessionStorage, `${orgId}/${paymentId}/refund`, key)
        toast.success("Customer credit refunded"); setAmount(""); setReference(""); router.refresh()
      } catch { toast.error("Could not confirm refund. Retry unchanged details.") }
    })
  }}><label>Refund amount (THB)<Input required disabled={pending} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <label>Refund bank reference<Input required minLength={3} maxLength={500} disabled={pending} value={reference} onChange={event => setReference(event.target.value)} /></label>
    <label>Refund date<Input required type="date" max={today} disabled={pending} value={date} onChange={event => setDate(event.target.value)} /></label>
    <label>Refund method<select className="block rounded border p-2 bg-background" disabled={pending} value={method} onChange={event => setMethod(event.target.value as Enums<"payment_method">)}>{["transfer", "cash", "card", "promptpay", "cheque", "other"].map(m => <option key={m}>{m}</option>)}</select></label>
    <Button type="submit" variant="outline" disabled={pending}>Refund customer credit</Button>
  </form>
}
