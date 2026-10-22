"use client"

import { useState, useTransition, type FormEvent } from "react"
import type { Tables } from "@/lib/types/database"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { receivePurchase } from "../actions"

export function ReceiptForm({ orderId, lines }: { orderId: string; lines: Tables<"purchase_order_items">[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await receivePurchase(orderId, lines.map(line => ({ id: line.id, received_quantity: Number(form.get(line.id)) })))
      setError(result.error ?? "")
    })
  }
  return <form id="receive" onSubmit={submit} className="scroll-mt-4 space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Receive products</h2>
    <p className="text-muted-foreground text-sm">Enter cumulative received totals. Partial receipts leave the remaining quantities open.</p>
    {lines.map(line => <div key={`${line.id}-${line.received_quantity}`} className="space-y-2">
      <Label htmlFor={`receive-${line.id}`}>Received total for {line.description}</Label>
      <div className="flex items-center gap-3"><Input id={`receive-${line.id}`} name={line.id} className="max-w-48" type="number" min={line.received_quantity} max={line.quantity} step="0.001" required defaultValue={line.quantity} /><span className="text-muted-foreground text-sm">of {line.quantity} {line.unit}, previously {line.received_quantity}</span></div>
    </div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Recording…" : "Record receipt"}</Button>
  </form>
}
