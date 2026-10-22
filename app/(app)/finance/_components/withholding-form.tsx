"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { WHT_RATES } from "@/lib/tax/totals"
import { updateInvoiceWithholding } from "../actions"

export function WithholdingForm({ invoiceId, rate }: { invoiceId: string; rate: number }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <label className="block text-sm">Withholding tax
    <select className="mt-1 block rounded border bg-background p-2" value={rate} disabled={pending} onChange={event => {
      const rateBps = Number(event.target.value)
      startTransition(async () => {
        try {
          const result = await updateInvoiceWithholding({ invoiceId, rateBps })
          if (result.error) { toast.error(result.error); return }
          router.refresh()
        } catch { toast.error("Could not confirm withholding. Reload before retrying.") }
      })
    }}>{WHT_RATES.map(value => <option key={value} value={value}>{value / 100}%</option>)}</select>
  </label>
}
