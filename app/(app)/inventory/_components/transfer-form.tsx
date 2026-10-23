"use client"

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import type { Tables } from "@/lib/types/database"
import { TransferInput } from "@/lib/inventory/schema"
import { transferStock } from "@/lib/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const subscribe = (change: () => void) => { window.addEventListener("storage", change); return () => window.removeEventListener("storage", change) }
export function TransferForm({ products, warehouses, scope }: { products: Pick<Tables<"products">, "id" | "name">[]; warehouses: Tables<"warehouses">[]; scope: string }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  const router = useRouter()
  const storageKey = `erp/inventory-transfer/${scope}`
  const serialized = useSyncExternalStore(subscribe, () => { try { return sessionStorage.getItem(storageKey) } catch { return null } }, () => null)
  let stored: unknown = null
  try { stored = JSON.parse(serialized ?? "null") } catch {}
  const saved = TransferInput.safeParse(stored)
  const command = saved.success ? saved.data : null
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      try {
        const value = command ?? TransferInput.parse({ product_id: form.get("product"), from_warehouse_id: form.get("from"), to_warehouse_id: form.get("to"), quantity: form.get("quantity"), reason: form.get("reason"), key: crypto.randomUUID() })
        sessionStorage.setItem(storageKey, JSON.stringify(value))
        if (sessionStorage.getItem(storageKey) !== JSON.stringify(value)) throw new Error("Browser storage is unavailable")
        window.dispatchEvent(new Event("storage"))
        const result = await transferStock(value)
        setMessage(result.error ?? "Stock transferred.")
        if (!result.error || result.rejected) { sessionStorage.removeItem(storageKey); window.dispatchEvent(new Event("storage")); router.refresh() }
      } catch (error) { setMessage(error instanceof Error ? error.message : "Transfer unavailable. Retry the saved transfer.") }
    })
  }
  return <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
    {command && <p role="status">A saved transfer awaits confirmation. Retry it before entering another transfer.</p>}
    <fieldset disabled={pending || !!command} className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="transfer-product">Product</Label><select id="transfer-product" name="product" required className="h-9 w-full rounded-md border" defaultValue={command?.product_id}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><Label htmlFor="transfer-quantity">Quantity</Label><Input id="transfer-quantity" name="quantity" type="number" min="0.001" step="0.001" required defaultValue={command?.quantity} /></div>
      {(["from", "to"] as const).map(key => <div key={key}><Label htmlFor={`transfer-${key}`}>{key === "from" ? "From warehouse" : "To warehouse"}</Label><select id={`transfer-${key}`} name={key} required className="h-9 w-full rounded-md border" defaultValue={command?.[`${key}_warehouse_id`]}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>)}
      <div><Label htmlFor="transfer-reason">Reason</Label><Input id="transfer-reason" name="reason" required maxLength={2000} defaultValue={command?.reason} /></div>
    </fieldset>
    {message && <p role="status">{message}</p>}
    <Button type="submit" disabled={pending}>{command ? "Retry saved transfer" : "Transfer stock"}</Button>
  </form>
}
