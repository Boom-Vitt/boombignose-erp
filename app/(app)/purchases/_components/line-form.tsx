"use client"

import { useState, useTransition, type FormEvent } from "react"
import { ProductPicker } from "@/app/(app)/products/_components/product-picker"
import type { PurchaseProduct } from "@/lib/purchasing/queries"
import { serviceAmountBaht } from "@/lib/workflows/service"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { addPurchaseLine } from "../actions"

export function PurchaseLineForm({ orderId, products }: { orderId: string; products: PurchaseProduct[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  const [productId, setProductId] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [unit, setUnit] = useState("piece")
  const [cost, setCost] = useState("0.00")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    start(async () => {
      const result = await addPurchaseLine({ ...values, product_id: productId, purchase_order_id: orderId })
      setError(result.error ?? "")
      if (!result.error) { setProductId(null); setDescription(""); setCost("0.00"); setUnit("piece"); form.reset() }
    })
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Add purchase line</h2>
    <ProductPicker products={products} value={productId} onChange={product => {
      setProductId(product?.id ?? null)
      if (product) {
        setDescription(product.description?.trim() || product.name)
        setUnit(product.unit)
        setCost(serviceAmountBaht(products.find(p => p.id === product.id)!.cost_satang))
      }
    }} />
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="description">Description</Label><Input id="description" name="description" maxLength={4000} required value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="quantity">Quantity</Label><Input id="quantity" name="quantity" type="number" min="0.001" step="0.001" required defaultValue="1" /></div>
      <div className="space-y-2"><Label htmlFor="unit">Unit</Label><Input id="unit" name="unit" maxLength={40} required readOnly={productId !== null} value={unit} onChange={e => setUnit(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="unitCostBaht">Unit cost (THB)</Label><Input id="unitCostBaht" name="unitCostBaht" inputMode="decimal" required value={cost} onChange={e => setCost(e.target.value)} /></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add line"}</Button>
  </form>
}
