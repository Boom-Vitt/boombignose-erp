"use client"

import { useState, useTransition, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createPurchase } from "../actions"

export function PurchaseForm({ vendors, today, vendorId }: { vendors: { id: string; name: string }[]; today: string; vendorId?: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = Object.fromEntries(new FormData(event.currentTarget))
    start(async () => { const result = await createPurchase(input); setError(result.error ?? "") })
  }
  return <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-xl border p-5">
    <div className="space-y-2"><Label htmlFor="vendor_id">Vendor</Label><select id="vendor_id" name="vendor_id" defaultValue={vendorId ?? ""} required className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="" disabled>Select a vendor</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
    <div className="space-y-2"><Label htmlFor="order_date">Order date</Label><Input id="order_date" name="order_date" type="date" required defaultValue={today} /></div>
    <div className="space-y-2"><Label htmlFor="expected_date">Expected date</Label><Input id="expected_date" name="expected_date" type="date" /></div>
    <div className="space-y-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" maxLength={10000} /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={pending || vendors.length === 0} type="submit">{pending ? "Creating…" : "Create purchase order"}</Button>
  </form>
}
