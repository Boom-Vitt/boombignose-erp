import { sumSatang, type Satang } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

export type InvoiceForProfit = {
  status: Enums<"invoice_status">
  total_satang: number
  vat_satang: number
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
 * Gross project profit: billed revenue before VAT (non-draft, non-cancelled
 * invoices) minus all recorded costs and labour at current member rates. Withholding is still revenue, so this
 * never reads the collectible amount_satang.
 */
export function projectProfit(
  invoices: InvoiceForProfit[],
  costs: CostForProfit[],
  labourCostSatang: Satang = 0,
  creditedBaseSatang: Satang = 0
): ProjectProfit {
  const revenueSatang = sumSatang(
    invoices
      .filter((i) => i.status !== "cancelled" && i.status !== "draft")
      .map((i) => i.total_satang - i.vat_satang)
  ) - creditedBaseSatang
  const costSatang = sumSatang([
    ...costs.map((c) => c.amount_satang),
    labourCostSatang,
  ])
  const profitSatang = revenueSatang - costSatang
  const marginPct = revenueSatang > 0 ? (profitSatang / revenueSatang) * 100 : 0
  return { revenueSatang, costSatang, profitSatang, marginPct }
}
