"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import type { Tables } from "@/lib/types/database"
import { adjustStock, saveReorder, saveWarehouse } from "@/lib/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const selectStyle = "h-9 w-full rounded-md border bg-background px-3 text-sm"

export function WarehouseForm({ warehouse }: { warehouse?: Tables<"warehouses"> }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  const router = useRouter()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await saveWarehouse({ id: warehouse?.id ?? null, code: form.get("code"), name: form.get("name"), address: form.get("address"), is_default: form.has("default"), active: form.has("active") })
      setMessage(result.error ?? "Warehouse saved.")
      if (!result.error) router.refresh()
    })
  }
  const prefix = warehouse?.id ?? "new"
  return <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
    <h2 className="font-semibold">{warehouse ? `Edit ${warehouse.name}` : "New warehouse"}</h2>
    <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`${prefix}-code`}>Code</Label><Input id={`${prefix}-code`} name="code" maxLength={40} required defaultValue={warehouse?.code} /></div><div><Label htmlFor={`${prefix}-name`}>Name</Label><Input id={`${prefix}-name`} name="name" maxLength={200} required defaultValue={warehouse?.name} /></div></div>
    <div><Label htmlFor={`${prefix}-address`}>Address</Label><Input id={`${prefix}-address`} name="address" maxLength={2000} defaultValue={warehouse?.address ?? ""} /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="default" defaultChecked={warehouse?.is_default} />Default warehouse</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={warehouse?.active ?? true} />Active</label>
    {message && <p role="status" className="text-sm">{message}</p>}
    <Button type="submit" disabled={pending}>{warehouse ? "Save warehouse" : "Create warehouse"}</Button>
  </form>
}

export function CountForm({ products, warehouses, balances }: { products: Pick<Tables<"products">, "id" | "name" | "unit">[]; warehouses: Tables<"warehouses">[]; balances: Tables<"stock_on_hand">[] }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [product, setProduct] = useState(products[0]?.id ?? "")
  const [warehouse, setWarehouse] = useState(warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? "")
  const router = useRouter()
  const onHand = balances.find(row => row.product_id === product && row.warehouse_id === warehouse)?.quantity ?? 0
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await adjustStock({ product_id: product, warehouse_id: warehouse, quantity: form.get("quantity"), reason: form.get("reason"), key })
      setMessage(result.error ?? "Count recorded.")
      if (!result.error) { setKey(crypto.randomUUID()); router.refresh() }
    })
  }
  return <form onSubmit={submit} className="max-w-xl space-y-4 rounded-xl border p-5">
    <div><Label htmlFor="count-product">Product</Label><select id="count-product" className={selectStyle} value={product} onChange={e => setProduct(e.target.value)} required>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div><Label htmlFor="count-warehouse">Warehouse</Label><select id="count-warehouse" className={selectStyle} value={warehouse} onChange={e => setWarehouse(e.target.value)} required>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>
    <p className="text-sm text-muted-foreground">Current on hand: {onHand} {products.find(p => p.id === product)?.unit}</p>
    <div><Label htmlFor="count-quantity">Counted quantity</Label><Input id="count-quantity" name="quantity" type="number" step="0.001" min="0" max="999999999.999" required /></div>
    <div><Label htmlFor="count-reason">Reason</Label><Input id="count-reason" name="reason" maxLength={2000} required /></div>
    {message && <p role="status" className="text-sm">{message}</p>}
    <Button type="submit" disabled={pending || !product || !warehouse}>Record count</Button>
  </form>
}

export function ReorderForm({ product, vendors }: { product: Tables<"products">; vendors: { id: string; name: string }[] }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  const router = useRouter()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await saveReorder({ product_id: product.id, reorder_min: form.get("min"), reorder_qty: form.get("qty"), default_vendor_id: form.get("vendor") })
      setMessage(result.error ?? "Rule saved.")
      if (!result.error) router.refresh()
    })
  }
  return <form onSubmit={submit} aria-label={`Replenishment rule for ${product.name}`} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
    <div className="sm:col-span-4 font-medium">{product.name}</div>
    <div><Label htmlFor={`${product.id}-min`}>Minimum quantity</Label><Input id={`${product.id}-min`} name="min" type="number" min="0" max="999999999.999" step="0.001" required defaultValue={product.reorder_min} /></div>
    <div><Label htmlFor={`${product.id}-qty`}>Reorder quantity</Label><Input id={`${product.id}-qty`} name="qty" type="number" min="0" max="999999999.999" step="0.001" required defaultValue={product.reorder_qty} /></div>
    <div><Label htmlFor={`${product.id}-vendor`}>Default vendor</Label><select id={`${product.id}-vendor`} name="vendor" className={selectStyle} defaultValue={product.default_vendor_id ?? ""}><option value="">Unassigned</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
    <Button className="self-end" type="submit" variant="outline" disabled={pending}>Save rule</Button>
    {message && <p role="status" className="text-sm sm:col-span-4">{message}</p>}
  </form>
}
