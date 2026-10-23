"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { serviceAmountSatang, serviceQuantityInput } from "@/lib/workflows/service"
import { ConvertQuoteButton } from "./convert-quote-button"

type Line = { id: string; description: string; quantity: number; invoiced_quantity: number }
type Mode = "remaining" | "selected" | "deposit_percent" | "deposit_amount"

export function QuoteInvoiceForm({ quoteId, orgId, lines, label, variant }: {
  quoteId: string
  orgId: string
  lines: Line[]
  label: string
  variant: "default" | "outline"
}) {
  const [mode, setMode] = useState<Mode>("remaining")
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [deposit, setDeposit] = useState("")
  const available = lines.filter((line) => line.quantity > line.invoiced_quantity)
  let request: React.ComponentProps<typeof ConvertQuoteButton>["request"] = {}
  let error = ""
  if (mode === "selected") {
    const selected = available.filter((line) => quantities[line.id] && Number(quantities[line.id]) !== 0)
    if (!selected.length) error = "Enter a quantity for at least one line."
    for (const line of selected) {
      const quantity = serviceQuantityInput.safeParse(quantities[line.id])
      if (!quantity.success || quantity.data > Number((line.quantity - line.invoiced_quantity).toFixed(3))) error = "Quantities must be positive, within the remaining scope, with up to three decimals."
    }
    request = { lines: selected.map((line) => ({ quote_item_id: line.id, quantity: quantities[line.id]! })) }
  } else if (mode.startsWith("deposit")) {
    try {
      const amount = serviceAmountSatang(deposit)
      if (amount <= 0 || (mode === "deposit_percent" && amount > 10000)) throw new Error("Invalid deposit")
      request = mode === "deposit_percent" ? { depositBps: amount } : { depositSatang: amount }
    } catch {
      error = mode === "deposit_percent" ? "Enter a percentage above 0 and up to 100, with up to two decimals." : "Enter a positive THB deposit with up to two decimals."
    }
  }
  return (
    <Dialog>
      <DialogTrigger render={<Button id="create-invoice" size="sm" variant={variant} />}>{label}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create draft invoice</DialogTitle>
          <DialogDescription>Invoice the remaining scope, selected quantities, or a deposit. Mixed-rate deposits are credited by tax bucket when the final invoice is issued.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`invoice-mode-${quoteId}`}>Invoice scope</Label>
          <select id={`invoice-mode-${quoteId}`} value={mode} onChange={(event) => setMode(event.target.value as Mode)} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm">
            <option value="remaining">All remaining quantities</option>
            <option value="selected">Selected quantities</option>
            <option value="deposit_percent">Deposit percentage</option>
            <option value="deposit_amount">Fixed deposit amount</option>
          </select>
        </div>
        {mode === "selected" ? <div className="max-h-64 space-y-3 overflow-y-auto">
          {available.map((line) => <div className="space-y-1" key={line.id}>
            <Label htmlFor={`invoice-quantity-${line.id}`}>{line.description} ({Number((line.quantity - line.invoiced_quantity).toFixed(3))} remaining)</Label>
            <Input id={`invoice-quantity-${line.id}`} type="number" min="0" step="0.001" max={Number((line.quantity - line.invoiced_quantity).toFixed(3))} value={quantities[line.id] ?? ""} onChange={(event) => setQuantities({ ...quantities, [line.id]: event.target.value })} />
          </div>)}
        </div> : null}
        {mode.startsWith("deposit") ? <div className="space-y-2">
          <Label htmlFor={`invoice-deposit-${quoteId}`}>{mode === "deposit_percent" ? "Deposit (%)" : "Deposit (THB)"}</Label>
          <Input id={`invoice-deposit-${quoteId}`} inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
          <p className="text-muted-foreground text-sm">Deposit percentages apply to the quote subtotal after discount. Mixed-rate deposits keep separate VAT buckets. Issuing the final invoice creates linked deposit credit notes and transfers the settled cash.</p>
        </div> : null}
        {error ? <p role="status" className="text-destructive text-sm">{error}</p> : null}
        <ConvertQuoteButton quoteId={quoteId} orgId={orgId} request={request} label="Create draft invoice" variant="default" disabled={!!error || !available.length} />
      </DialogContent>
    </Dialog>
  )
}
