"use client"

import { useState, useTransition, type FormEvent } from "react"
import { savePurchasingPolicy } from "@/lib/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PurchasingPolicyForm({ tolerancePercent }: { tolerancePercent: number }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await savePurchasingPolicy({ over_receipt_tolerance_percent: Number(form.get("tolerance")) })
      setMessage(result.error ?? "Purchasing policy saved.")
    })
  }
  return <form onSubmit={submit} className="max-w-xl space-y-4 rounded-xl border p-4">
    <div><Label htmlFor="over-receipt-tolerance">Over-receipt tolerance (%)</Label><Input id="over-receipt-tolerance" name="tolerance" type="number" min="0" max="100" step="0.01" required defaultValue={tolerancePercent} /></div>
    {message && <p role="status">{message}</p>}
    <Button type="submit" disabled={pending}>Save purchasing policy</Button>
  </form>
}
