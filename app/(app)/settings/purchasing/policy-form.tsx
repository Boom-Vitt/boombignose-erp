"use client"

import { useState, useTransition, type FormEvent } from "react"
import { serviceAmountSatang } from "@/lib/workflows/service"
import { satangToBahtString } from "@/lib/money"
import { savePurchasingPolicy } from "@/lib/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PurchasingPolicyForm({ tolerancePercent, approvalThreshold, scheduled }: { tolerancePercent: number; approvalThreshold: number | null; scheduled: boolean }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await savePurchasingPolicy({ scheduled_replenishment_enabled: form.has("scheduled"), over_receipt_tolerance_percent: Number(form.get("tolerance")), purchase_approval_threshold_satang: form.get("threshold") ? serviceAmountSatang(String(form.get("threshold"))) : null })
      setMessage(result.error ?? "Purchasing policy saved.")
    })
  }
  return <form onSubmit={submit} className="max-w-xl space-y-4 rounded-xl border p-4">
    <div><Label htmlFor="over-receipt-tolerance">Over-receipt tolerance (%)</Label><Input id="over-receipt-tolerance" name="tolerance" type="number" min="0" max="100" step="0.01" required defaultValue={tolerancePercent} /></div>
    <div><Label htmlFor="purchase-approval-threshold">Approval threshold (baht)</Label><Input id="purchase-approval-threshold" name="threshold" type="number" min="0" step="0.01" defaultValue={approvalThreshold === null ? "" : satangToBahtString(approvalThreshold)} /><p className="text-sm text-muted-foreground">Blank disables double validation. Orders strictly above this amount need a separate owner/admin approval before confirmation.</p></div>
    <label className="flex items-center gap-2"><input name="scheduled" type="checkbox" defaultChecked={scheduled} />Enable scheduled replenishment RFQs</label>
    <p className="text-sm text-muted-foreground">A configured scheduler calls the secret-protected replenishment endpoint. Draft RFQs are created for review.</p>
    {message && <p role="status">{message}</p>}
    <Button type="submit" disabled={pending}>Save purchasing policy</Button>
  </form>
}
