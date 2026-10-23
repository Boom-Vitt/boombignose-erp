"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { todayISO } from "@/lib/dates"
import type { Tables } from "@/lib/types/database"
import { serviceAmountSatang, serviceAmountBaht } from "@/lib/workflows/service"
import { creditableBillLines } from "@/lib/purchasing/credit-matching"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { linkVendorCredit } from "../actions"

export function CreditForm({ costId, matches, bills, credits, lines }: { costId: string; matches: Tables<"vendor_bill_matches">[]; bills: Tables<"costs">[]; credits: Tables<"costs">[]; lines: Tables<"purchase_order_items">[] }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  let originals: ReturnType<typeof creditableBillLines>
  try { originals = creditableBillLines(matches, bills, lines) }
  catch { return <p role="alert" className="text-sm">Vendor bill or credit line evidence needs reconciliation before another credit can be linked.</p> }
  if (!originals.length) return <p className="text-sm">No uncredited billed return quantities are available. Match an original vendor invoice before linking its credit note.</p>
  return <details className="mt-2"><summary className="cursor-pointer">Link vendor credit note</summary><form className="mt-3 space-y-2" onSubmit={event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    let vat: number
    try { vat = serviceAmountSatang(String(form.get("vat"))) } catch { toast.error("Invalid credit VAT"); return }
    const allocations = originals.map(original => ({ original_bill_id: original.original_bill_id, lines: original.lines.map(line => ({ id: line.id, quantity: Number(form.get(`quantity-${original.original_bill_id}-${line.id}`)) })).filter(line => line.quantity > 0) })).filter(allocation => allocation.lines.length > 0)
    const input = { vendor_reference: String(form.get("reference")), bill_date: String(form.get("date")), input_vat_satang: vat, variance_reason: String(form.get("reason")), cost_ids: [costId, ...form.getAll("costs").map(String)], allocations }
    start(async () => {
      try {
        const result = await linkVendorCredit(costId, input)
        if (result.error) { toast.error(result.error); return }
        toast.success("Vendor credit linked")
        router.refresh()
      } catch { toast.error("Could not confirm the credit. Reload before retrying.") }
    })
  }}>
    <p className="text-sm">Allocate the selected return costs to one or more original invoices. Each original invoice determines its credit price and VAT rate. Enter the total VAT as a positive credit amount.</p>
    <fieldset className="space-y-2"><legend>Return costs covered by this credit note</legend>{credits.map(credit => <label key={credit.id} className="flex items-center gap-2"><input type="checkbox" name="costs" value={credit.id} defaultChecked={credit.id === costId} disabled={credit.id === costId || pending} />{credit.bill_number} ({credit.category}, PO base {serviceAmountBaht(Math.abs(credit.amount_satang))} THB)</label>)}</fieldset>
    {originals.map(original => <fieldset key={original.original_bill_id} className="space-y-2 rounded-md border p-3"><legend>Original invoice {original.vendor_reference}</legend>
      <p className="text-sm">Original VAT rate {original.input_vat_rate}%</p>
      {original.lines.map(line => <div key={line.id}><label className="block">Credit quantity for {line.description} from {original.vendor_reference}<Input name={`quantity-${original.original_bill_id}-${line.id}`} type="number" min="0" max={line.maximum_quantity} step="0.001" defaultValue="0" disabled={pending} /></label><p className="text-sm text-muted-foreground">Remaining billed quantity {line.remaining_quantity}. Returned quantity available {line.maximum_quantity}.</p></div>)}
    </fieldset>)}
    <label className="block">Credit note reference<Input name="reference" required maxLength={200} /></label>
    <label className="block">Credit note date<Input name="date" type="date" required defaultValue={todayISO()} /></label>
    <label className="block">Credit VAT (THB)<Input name="vat" type="number" min="0" step="0.01" required defaultValue="0" /></label>
    <label className="block">Credit variance reason<Input name="reason" maxLength={2000} /></label>
    <Button type="submit" disabled={pending}>Link credit note</Button>
  </form></details>
}
