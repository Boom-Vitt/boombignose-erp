import { z } from "zod"
import { formatTHB } from "@/lib/money"

const Breakdown = z.array(z.object({ rateBps: z.number().int().min(0).max(10000), vatSatang: z.number().int().nonnegative() }))

export function DocumentTotals({ subtotal, discount, vat, total, wht = 0, whtRate = 0, amountDue = total - wht, breakdown = [], inclusive = false }: {
  subtotal: number; discount: number; vat: number; total: number; wht?: number; whtRate?: number; amountDue?: number; breakdown?: unknown; inclusive?: boolean
}) {
  const rates = Breakdown.parse(breakdown).filter(rate => rate.rateBps > 0)
  const rows: [string, number][] = [
    ["Subtotal", subtotal], ["Discount", discount ? -discount : 0],
    ...(rates.length ? rates.map(rate => [`VAT ${rate.rateBps / 100}%`, rate.vatSatang] as [string, number]) : [["VAT", vat] as [string, number]]),
    ["Total", total], [`WHT ${whtRate / 100}%`, wht ? -wht : 0], ["Amount due", amountDue],
  ]
  return <div className="space-y-2" data-testid="document-totals">
    <dl className="ml-auto max-w-sm space-y-2 text-sm">{rows.map(([label, value]) => <div key={label} className={`flex justify-between gap-6 ${label === "Amount due" ? "border-t pt-2 font-semibold" : ""}`}><dt>{label}</dt><dd className="tabular-nums">{formatTHB(value)}</dd></div>)}</dl>
    {inclusive ? <p className="text-xs text-muted-foreground">Entered prices and discounts include VAT. VAT is extracted after discount.</p> : null}
  </div>
}
