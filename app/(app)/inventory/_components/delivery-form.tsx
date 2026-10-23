"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import type { Tables } from "@/lib/types/database"
import { deliverInvoice, returnInvoiceDelivery } from "@/lib/inventory/actions"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type DeliveryLine = { id: string; product_id: string | null; description: string; quantity: number; unit: string | null; delivered_quantity: number; returned_quantity: number }
type Availability = { id: string; quantity: number; reserved_quantity: number }
const selectStyle = "h-9 rounded-md border bg-background px-3 text-sm"

export function DeliveryForm({ invoiceId, lines, warehouses, products }: { invoiceId: string; lines: DeliveryLine[]; warehouses: Tables<"warehouses">[]; products: Availability[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  const router = useRouter()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await deliverInvoice(invoiceId, String(form.get("warehouse")), lines.map(line => ({ id: line.id, delivered_quantity: Number(form.get(line.id)), previous_delivered_quantity: line.delivered_quantity })), String(form.get("date")))
      setError(result.error ?? "")
      if (!result.error) router.refresh()
    })
  }
  return <form id="deliver" onSubmit={submit} className="space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Deliver products</h2>
    <p className="text-sm text-muted-foreground">Enter cumulative delivered totals. Available stock subtracts all undelivered issued invoice quantities, including this invoice.</p>
    <div><Label htmlFor="delivery-date">Delivery date</Label><Input id="delivery-date" name="date" type="date" required defaultValue={todayISO()} /></div>
    <div><Label htmlFor="delivery-warehouse">Deliver from warehouse</Label><select id="delivery-warehouse" name="warehouse" className={selectStyle} defaultValue={warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id} required>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>
    {lines.map(line => {
      const product = products.find(product => product.id === line.product_id)
      const available = product ? product.quantity - product.reserved_quantity : 0
      return <div key={`${line.id}-${line.delivered_quantity}`} className="space-y-2">
        <Label htmlFor={`deliver-${line.id}`}>Delivered total for {line.description}</Label>
        <div className="flex items-center gap-3"><Input id={`deliver-${line.id}`} name={line.id} className="max-w-48" type="number" min={line.delivered_quantity} max={line.quantity} step="0.001" required defaultValue={line.delivered_quantity} /><span className="text-sm text-muted-foreground">of {line.quantity} {line.unit}, previously {line.delivered_quantity}, returned {line.returned_quantity}</span></div>
        <p className="text-sm">On hand {product?.quantity ?? 0} · Available {available} {line.unit}</p>
        {available < 0 && <p role="status" className="text-sm text-destructive">Issued invoices exceed on-hand stock. Replenish stock before completing delivery.</p>}
      </div>
    })}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={pending || !warehouses.length} type="submit">Record delivery</Button>
  </form>
}

export function CustomerReturnForm({ invoiceId, move, returnedQuantity, description, warehouse }: { invoiceId: string; move: Tables<"stock_moves">; returnedQuantity: number; description: string; warehouse: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  const router = useRouter()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quantity = Number(new FormData(event.currentTarget).get("returned"))
    start(async () => {
      const result = await returnInvoiceDelivery(invoiceId, move.id, quantity)
      setError(result.error ?? "")
      if (!result.error) router.refresh()
    })
  }
  return <form onSubmit={submit} className="space-y-3 rounded-xl border p-4">
    <h3 className="font-medium">Return {description}</h3>
    <p className="text-sm text-muted-foreground">Delivery {new Date(move.moved_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} · {move.quantity} units · {warehouse} · Original unit cost {formatTHB(move.unit_cost_satang)}. Returns restore this warehouse at the original delivery cost.</p>
    <Label htmlFor={`customer-return-${move.id}`}>Cumulative returned quantity</Label>
    <Input key={`${move.id}-${returnedQuantity}`} id={`customer-return-${move.id}`} name="returned" type="number" min={returnedQuantity} max={move.quantity} step="0.001" required defaultValue={returnedQuantity} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>Record customer return</Button>
  </form>
}
