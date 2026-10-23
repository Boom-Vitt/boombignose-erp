"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { paymentAmount } from "@/lib/payments/input"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { formatTHB } from "@/lib/money"
import { reportCustomerReceipt, applyCustomerCredit } from "../receipt-actions"

export function CustomerReceiptForm({ orgId, clientId, invoices, mode }: { orgId: string; clientId: string; invoices: { id: string; number: string; outstanding: number }[]; mode: "report" | "apply" }) {
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const allocations = invoices.filter(i => values[i.id]?.trim()).map(i => ({ invoiceId: i.id, amountSatang: paymentAmount(values[i.id]) }))
        const key = paymentCommandKey(sessionStorage, `${orgId}/${clientId}/${mode}`, [amount, reference, JSON.stringify(allocations)], () => crypto.randomUUID())
        const common = { clientId, key, allocations }
        const result = mode === "report" ? await reportCustomerReceipt({ ...common, amountBaht: amount, reference }) : await applyCustomerCredit(common)
        if (result.error) { toast.error(result.error); return }
        toast.success(mode === "report" ? "Receipt reported for verification" : "Customer credit applied")
        setValues({}); setAmount(""); setReference(""); router.refresh()
      } catch (error) { toast.error(error instanceof Error ? error.message : "Could not confirm. Retry unchanged details.") }
    })
  }}>
    {mode === "report" ? <><label>Receipt amount (THB)<Input required disabled={pending} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>Receipt report reference<Input required maxLength={500} disabled={pending} value={reference} onChange={event => setReference(event.target.value)} /></label><p className="text-sm">Any excess remains customer credit after verification.</p></> : null}
    {invoices.map(i => <label className="block" key={i.id}>Allocate {i.number} · open {formatTHB(i.outstanding)}<Input disabled={pending} inputMode="decimal" value={values[i.id] ?? ""} onChange={event => setValues({ ...values, [i.id]: event.target.value })} /></label>)}
    <Button type="submit" disabled={pending}>{mode === "report" ? "Report customer receipt" : "Apply customer credit"}</Button>
  </form>
}
