"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { moneyInput } from "@/lib/payments/input"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { issueCreditNote } from "../correction-actions"

export function CreditNoteForm({ orgId, invoiceId, lines }: { orgId: string; invoiceId: string; lines: { id: string; description: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<"amount" | "quantity">("amount")
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const selected = lines.filter(line => values[line.id]?.trim()).map(line => mode === "amount"
          ? { mode, invoiceItemId: line.id, amountSatang: moneyInput(values[line.id]) }
          : { mode, invoiceItemId: line.id, quantity: Number(values[line.id]) })
        const key = paymentCommandKey(sessionStorage, `${orgId}/${invoiceId}/credit`, [mode, reason, JSON.stringify(selected)], () => crypto.randomUUID())
        const result = await issueCreditNote({ invoiceId, key, reason, lines: selected })
        if (result.error) { toast.error(result.error); return }
        toast.success("Credit note issued")
        setValues({}); setReason(""); router.refresh()
      } catch (error) { toast.error(error instanceof Error ? error.message : "Could not confirm the credit note. Retry unchanged details.") }
    })
  }}>
    <label className="block text-sm">Credit by<select className="block rounded border p-2 bg-background" disabled={pending} value={mode} onChange={event => { setMode(event.target.value as "amount" | "quantity"); setValues({}) }}><option value="amount">Line amount (THB before original discount)</option><option value="quantity">Line quantity</option></select></label>
    {lines.map(line => <label key={line.id} className="block text-sm">Credit {line.description}<Input disabled={pending} inputMode="decimal" value={values[line.id] ?? ""} onChange={event => setValues({ ...values, [line.id]: event.target.value })} /></label>)}
    <p className="text-xs text-muted-foreground">Leave unchanged lines blank. Original discounts and tax buckets are prorated. Issued notes are permanent.</p>
    <label className="block text-sm">Credit reason<Input required minLength={3} maxLength={1000} disabled={pending} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <Button type="submit" disabled={pending}>Issue credit note</Button>
  </form>
}
