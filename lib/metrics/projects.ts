import { sumSatang, type Satang } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

export type InvoiceForProfit = {
  status: Enums<"invoice_status">
  amount_satang: number
}
export type CostForProfit = { amount_satang: number }

export type ProjectProfit = {
  revenueSatang: Satang
  costSatang: Satang
  profitSatang: Satang
  /** Gross margin as a percentage (0 when there is no revenue). */
  marginPct: number
}

/**
 * Gross project profit: billed revenue (non-draft, non-cancelled invoices)
 * minus all recorded costs.
 */
export function projectProfit(
  invoices: InvoiceForProfit[],
  costs: CostForProfit[]
): ProjectProfit {
  const revenueSatang = sumSatang(
    invoices
      .filter((i) => i.status !== "cancelled" && i.status !== "draft")
      .map((i) => i.amount_satang)
  )
  const costSatang = sumSatang(costs.map((c) => c.amount_satang))
  const profitSatang = revenueSatang - costSatang
  const marginPct = revenueSatang > 0 ? (profitSatang / revenueSatang) * 100 : 0
  return { revenueSatang, costSatang, profitSatang, marginPct }
}
