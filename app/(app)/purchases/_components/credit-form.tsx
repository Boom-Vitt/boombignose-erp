"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { todayISO } from "@/lib/dates"
import type { Tables } from "@/lib/types/database"
import { serviceAmountSatang, serviceAmountBaht } from "@/lib/workflows/service"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { linkVendorCredit } from "../actions"

export function CreditForm({ costId, originals, credits, lines }: { costId: string; originals: Tables<"costs">[]; credits: Tables<"costs">[]; lines: Tables<"purchase_order_items">[] }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  const unique = [...new Map(originals.map(item => [item.vendor_bill_match_id, item])).values()]
  if (!unique.length) return <p className="text-sm">Match an original vendor invoice before linking its credit note.</p>
  return <details className="mt-2"><summary className="cursor-pointer">Link vendor credit note</summary><form className="mt-3 space-y-2" onSubmit={event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    let vat: number
    try { vat = serviceAmountSatang(String(form.get("vat"))) } catch { toast.error("Invalid credit VAT"); return }
    const returned = lines.map(line => ({ id: line.id, quantity: Number(form.get(`quantity-${line.id}`)) })).filter(line => line.quantity > 0)
    const input = { vendor_reference: String(form.get("reference")), bill_date: String(form.get("date")), original_bill_id: String(form.get("original")), input_vat_rate: Number(form.get("rate")), input_vat_satang: vat, variance_reason: String(form.get("reason")), cost_ids: [costId, ...form.getAll("costs").map(String)], lines: returned }
    start(async () => {
      try {
        const result = await linkVendorCredit(costId, input)
        if (result.error) { toast.error(result.error); return }
        toast.success("Vendor credit linked")
        router.refresh()
      } catch { toast.error("Could not confirm the credit. Reload before retrying.") }
    })
  }}>
    <p className="text-sm">Enter the returned quantities covered by this note. The original invoice determines the credit price. Enter VAT as a positive credit amount.</p>
    <fieldset className="space-y-2"><legend>Return costs covered by this credit note</legend>{credits.map(credit => <label key={credit.id} className="flex items-center gap-2"><input type="checkbox" name="costs" value={credit.id} defaultChecked={credit.id === costId} disabled={credit.id === costId || pending} />{credit.bill_number} ({credit.category}, PO base {serviceAmountBaht(Math.abs(credit.amount_satang))} THB)</label>)}</fieldset>
    {lines.filter(line => line.returned_quantity > 0).map(line => <label className="block" key={line.id}>Credit quantity for {line.description}<Input name={`quantity-${line.id}`} type="number" min="0" max={line.returned_quantity} step="0.001" defaultValue="0" /></label>)}
    <label className="block">Credit note reference<Input name="reference" required maxLength={200} /></label>
    <label className="block">Credit note date<Input name="date" type="date" required defaultValue={todayISO()} /></label>
    <label className="block">Original vendor invoice<select className="w-full rounded-md border p-2" name="original" required>{unique.map(item => <option key={item.vendor_bill_match_id} value={item.vendor_bill_match_id ?? ""}>{item.vendor_invoice_reference}</option>)}</select></label>
    <label className="block">Credit VAT rate (%)<Input name="rate" type="number" min="0" max="100" step="0.01" required defaultValue={0} /></label>
    <label className="block">Credit VAT (THB)<Input name="vat" type="number" min="0" step="0.01" required defaultValue="0" /></label>
    <label className="block">Credit variance reason<Input name="reason" maxLength={2000} /></label>
    <Button type="submit" disabled={pending}>Link credit note</Button>
  </form></details>
}
