"use client"

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import type { Tables } from "@/lib/types/database"
import { adjustStock, saveReorder, saveWarehouse } from "@/lib/inventory/actions"
import { acknowledgeCountCommand, prepareCountCommand, readPendingCount, type CountCommand } from "@/lib/inventory/retry-command"
import { serviceAmountSatang } from "@/lib/workflows/service"
import { satangToBahtString } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const selectStyle = "h-9 w-full rounded-md border bg-background px-3 text-sm"

function browserStore(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

function subscribeCountStorage(change: () => void) {
  window.addEventListener("storage", change)
  return () => window.removeEventListener("storage", change)
}

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

export function CountForm({ products, warehouses, balances, scope }: { products: Pick<Tables<"products">, "id" | "name" | "unit">[]; warehouses: Tables<"warehouses">[]; balances: Tables<"stock_on_hand">[]; scope: string }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  const [pendingCommand, setPendingCommand] = useState<CountCommand | null>(null)
  const saved = useSyncExternalStore(subscribeCountStorage, () => JSON.stringify(readPendingCount(browserStore(), scope)), () => "null")
  const command = pendingCommand ?? (JSON.parse(saved) as CountCommand | null)
  const [selectedProduct, setProduct] = useState(products[0]?.id ?? "")
  const [selectedWarehouse, setWarehouse] = useState(warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? "")
  const [quantity, setQuantity] = useState("")
  const [reason, setReason] = useState("")
  const [unitCost, setUnitCost] = useState("")
  const product = command?.product_id ?? selectedProduct
  const warehouse = command?.warehouse_id ?? selectedWarehouse
  const router = useRouter()
  const onHand = balances.find(row => row.product_id === product && row.warehouse_id === warehouse)?.quantity ?? 0
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let request: CountCommand
    try {
      request = prepareCountCommand(browserStore(), scope, command ?? { product_id: product, warehouse_id: warehouse, quantity: Number(quantity), reason, unit_cost_satang: unitCost.trim() ? serviceAmountSatang(unitCost) : null }, () => crypto.randomUUID())
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid count"); return }
    setProduct(request.product_id)
    setWarehouse(request.warehouse_id)
    setQuantity(String(request.quantity))
    setReason(request.reason)
    setUnitCost(request.unit_cost_satang == null ? "" : satangToBahtString(request.unit_cost_satang))
    setPendingCommand(request)
    start(async () => {
      try {
        const result = await adjustStock(request)
        if (!acknowledgeCountCommand(browserStore(), scope, request.key, result)) {
          setMessage(result.error !== undefined ? `${result.error} Retry the saved count before entering a new count.` : "Count response received, but browser recovery could not be cleared. Retry the saved count.")
          return
        }
        setPendingCommand(null)
        setMessage(result.error ?? "Count recorded.")
        if (!result.error) router.refresh()
      } catch { setMessage("Could not confirm the count response. Retry the saved count before entering a new count.") }
    })
  }
  return <form onSubmit={submit} className="max-w-xl space-y-4 rounded-xl border p-5">
    {command && <p className="text-sm">A saved count is awaiting confirmation. Retry it before entering another count.</p>}
    <fieldset disabled={pending || !!command} className="space-y-4">
    <div><Label htmlFor="count-product">Product</Label><select id="count-product" className={selectStyle} value={product} onChange={e => setProduct(e.target.value)} required>{command && !products.some(p => p.id === product) && <option value={product}>{product} (saved product)</option>}{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div><Label htmlFor="count-warehouse">Warehouse</Label><select id="count-warehouse" className={selectStyle} value={warehouse} onChange={e => setWarehouse(e.target.value)} required>{command && !warehouses.some(w => w.id === warehouse) && <option value={warehouse}>{warehouse} (saved warehouse)</option>}{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>
    <p className="text-sm text-muted-foreground">Current on hand: {onHand} {products.find(p => p.id === product)?.unit}</p>
    <div><Label htmlFor="count-quantity">Counted quantity</Label><Input id="count-quantity" name="quantity" type="number" step="0.001" min="0" max="999999999.999" required value={command ? String(command.quantity) : quantity} onChange={e => setQuantity(e.target.value)} /></div>
    <div><Label htmlFor="count-unit-cost">Unit cost (THB)</Label><Input id="count-unit-cost" inputMode="decimal" type="number" min="0" step="0.01" required={onHand <= 0 && Number(command?.quantity ?? quantity) > onHand} value={command ? (command.unit_cost_satang == null ? "" : satangToBahtString(command.unit_cost_satang)) : unitCost} onChange={e => setUnitCost(e.target.value)} /><p className="text-xs text-muted-foreground">Required when increasing stock from zero or below. Positive-stock counts retain the current average cost.</p></div>
    <div><Label htmlFor="count-reason">Reason</Label><Input id="count-reason" name="reason" maxLength={2000} required value={command?.reason ?? reason} onChange={e => setReason(e.target.value)} /></div>
    </fieldset>
    {message && <p role="status" className="text-sm">{message}</p>}
    <Button type="submit" disabled={pending || !product || !warehouse}>{command ? "Retry saved count" : "Record count"}</Button>
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
    <div><Label htmlFor={`${product.id}-qty`}>Reorder quantity</Label><Input id={`${product.id}-qty`} name="qty" type="number" min="0.001" max="999999999.999" step="0.001" required defaultValue={product.reorder_qty} /></div>
    <div><Label htmlFor={`${product.id}-vendor`}>Default vendor</Label><select id={`${product.id}-vendor`} name="vendor" className={selectStyle} defaultValue={product.default_vendor_id ?? ""}><option value="">Unassigned</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
    <Button className="self-end" type="submit" variant="outline" disabled={pending}>Save rule</Button>
    {message && <p role="status" className="text-sm sm:col-span-4">{message}</p>}
  </form>
}
