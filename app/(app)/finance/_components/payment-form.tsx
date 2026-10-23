"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { Enums } from "@/lib/types/database"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { paymentAmount } from "@/lib/payments/input"
import { paymentCommandKey, completePaymentCommand } from "@/lib/payments/retry-command"
import { recordPayment, reconcileLegacyPayment } from "../actions"

/** Bank reports stay pending. Legacy matching creates a new linked receipt. */
export function PaymentForm({ orgId, invoiceId, suggestedBaht, legacyPaymentId, today }: {
  orgId: string; invoiceId: string; suggestedBaht: string; legacyPaymentId?: string; today: string
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(suggestedBaht)
  const [paidOn, setPaidOn] = useState(today)
  const [method, setMethod] = useState<Enums<"payment_method">>("transfer")
  const [reference, setReference] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()
  const command = useRef<{ details: string; key: string } | null>(null)
  const scope = `${orgId}/${invoiceId}/${legacyPaymentId ?? "staff-report"}`
  const reconcile = !!legacyPaymentId

  function submit() {
    try { paymentAmount(amount) } catch { toast.error("Enter a positive THB amount with up to two decimals"); return }
    if (reference.trim().length < 3 || (reconcile && !confirmed)) return
    const details = JSON.stringify([amount, reference.trim(), ...(reconcile ? [paidOn, method] : [])])
    if (command.current?.details !== details) {
      let key: string
      try { key = paymentCommandKey(sessionStorage, scope, [amount, reference.trim(), ...(reconcile ? [paidOn, method] : [])], () => crypto.randomUUID()) }
      catch { key = crypto.randomUUID() }
      command.current = { details, key }
    }
    const key = command.current.key
    startTransition(async () => {
      try {
        const input = { invoiceId, amountBaht: amount, reference: reference.trim(), key }
        const result = legacyPaymentId
          ? await reconcileLegacyPayment({ ...input, legacyPaymentId, paidOn, method })
          : await recordPayment(input)
        if (result.error) { toast.error(result.error); return }
        completePaymentCommand(sessionStorage, scope, key)
        command.current = null
        toast.success(reconcile ? "สร้างใบรับเงินที่ตรวจสอบแล้ว / Legacy receipt reconciled" : "รอตรวจสอบ / Payment claim submitted")
        router.refresh()
      } catch { toast.error("Could not confirm the response. Retry unchanged details to recover the original result.") }
    })
  }
  return <div className="space-y-3">
    <label className="block text-sm">{reconcile ? "Verified legacy amount (THB)" : "Reported amount (THB)"}
      <Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={pending} />
    </label>
    <label className="block text-sm">{reconcile ? "Legacy bank evidence reference" : "Staff payment report reference"}
      <Input value={reference} onChange={event => setReference(event.target.value)} maxLength={500} disabled={pending} placeholder="Statement transaction or receipt reference" />
    </label>
    {reconcile ? <><label className="block text-sm">Legacy bank receipt date<Input disabled={pending} type="date" max={today} value={paidOn} onChange={event=>setPaidOn(event.target.value)} /></label><label className="block text-sm">Legacy receipt method<select disabled={pending} className="block w-full rounded border p-2 bg-background" value={method} onChange={event=>setMethod(event.target.value as Enums<"payment_method">)}>{["transfer","promptpay","cash","card","cheque","other"].map(value=><option key={value} value={value}>{value}</option>)}</select></label></> : null}
    {reconcile ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} />I matched this retained receipt to actual bank evidence. A new verified receipt will be linked; the original stays in the history.</label> : <p className="text-xs text-muted-foreground">บันทึกคำแจ้งชำระ รอเจ้าหน้าที่ตรวจสอบ / This report has no effect on received cash until verified.</p>}
    <Button onClick={submit} disabled={pending || reference.trim().length < 3 || (reconcile && !confirmed)}>{reconcile ? "Reconcile legacy receipt" : "Report payment for verification"}</Button>
  </div>
}
