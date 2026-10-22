"use client"

import { useState, useTransition, type FormEvent } from "react"
import type { Tables } from "@/lib/types/database"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { receivePurchase, returnPurchase } from "../actions"

export function ReceiptForm({ orderId, lines, warehouses = [] }: { orderId: string; lines: Tables<"purchase_order_items">[]; warehouses?: Tables<"warehouses">[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await receivePurchase(orderId, lines.map(line => ({ id: line.id, previous_received_quantity: line.received_quantity, received_quantity: Number(form.get(line.id)) })), String(form.get("warehouse") ?? "") || undefined)
      setError(result.error ?? "")
    })
  }
  return <form id="receive" onSubmit={submit} className="scroll-mt-4 space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Receive products</h2>
    <p className="text-muted-foreground text-sm">Enter cumulative received totals. Partial receipts leave the remaining quantities open.</p>
    {warehouses.length > 0 && <div><Label htmlFor="receipt-warehouse">Receive into warehouse</Label><select id="receipt-warehouse" name="warehouse" className="h-9 rounded-md border bg-background px-3 text-sm" defaultValue={warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>}
    {lines.map(line => <div key={`${line.id}-${line.received_quantity}`} className="space-y-2">
      <Label htmlFor={`receive-${line.id}`}>Received total for {line.description}</Label>
      <div className="flex items-center gap-3"><Input id={`receive-${line.id}`} name={line.id} className="max-w-48" type="number" min={line.received_quantity} max={line.quantity} step="0.001" required defaultValue={line.quantity} /><span className="text-muted-foreground text-sm">of {line.quantity} {line.unit}, previously {line.received_quantity}</span></div>
    </div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Recording…" : "Record receipt"}</Button>
  </form>
}

export function PurchaseReturnForm({ orderId, lines, warehouses }: { orderId: string; lines: Tables<"purchase_order_items">[]; warehouses: Tables<"warehouses">[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await returnPurchase(orderId, lines.map(line => ({ id: line.id, returned_quantity: Number(form.get(line.id)) })), String(form.get("warehouse") ?? "") || undefined)
      setError(result.error ?? "")
    })
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Return to vendor</h2>
    <p className="text-sm text-muted-foreground">Enter cumulative returned totals. Stock leaves at the current average cost. Returns of billed quantities create a vendor credit at the purchase line cost.</p>
    {warehouses.length > 0 && <div><Label htmlFor="return-warehouse">Return from warehouse</Label><select id="return-warehouse" name="warehouse" className="h-9 rounded-md border bg-background px-3 text-sm" defaultValue={warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id} required>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>}
    {lines.map(line => <div key={`${line.id}-${line.returned_quantity}`} className="space-y-2"><Label htmlFor={`return-${line.id}`}>Returned total for {line.description}</Label><div className="flex items-center gap-3"><Input id={`return-${line.id}`} name={line.id} className="max-w-48" type="number" min={line.returned_quantity} max={line.received_quantity} step="0.001" required defaultValue={line.returned_quantity} /><span className="text-sm text-muted-foreground">of {line.received_quantity} received {line.unit}</span></div></div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>Record vendor return</Button>
  </form>
}
