import { sumSatang } from "@/lib/money"
import { serviceLineAmount } from "@/lib/workflows/service"
import type { PurchaseLine } from "./quantities"

export type BillLine = { id: string; quantity: number; unit_cost_satang: number; expected_quantity: number }
export type BillMatchOptions = { vatRate: number; vat?: number; total?: number; toleranceBps: number }
const safe = (value: number) => Number.isSafeInteger(value) && value >= 0
const rounded = (numerator: bigint, denominator: bigint) => Number((numerator + denominator / BigInt(2)) / denominator)

export function defaultBillLines(lines: PurchaseLine[]): BillLine[] {
  return lines.flatMap(line => {
    const quantity = (Math.round(line.received_quantity * 1000) - Math.round((line.returned_quantity ?? 0) * 1000) - Math.round(line.billed_quantity * 1000)) / 1000
    return quantity > 0 ? [{ id: line.id, quantity, unit_cost_satang: line.unit_cost_satang, expected_quantity: quantity }] : []
  })
}

export function billDueDate(date: string, days: number): string {
  const due = new Date(`${date}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + days)
  return due.toISOString().slice(0, 10)
}

export function matchBill(purchaseLines: PurchaseLine[], lines: BillLine[], options: BillMatchOptions) {
  const expected = defaultBillLines(purchaseLines)
  const rateBps = Math.round(options.vatRate * 100)
  if (!safe(rateBps) || rateBps > 10000 || Math.abs(rateBps - options.vatRate * 100) > 0.00001 || !safe(options.toleranceBps) || options.toleranceBps > 10000) throw new Error("Invalid VAT rate or tolerance")
  if (!lines.length || lines.length !== expected.length || new Set(lines.map(line => line.id.toLowerCase())).size !== lines.length || expected.some(item => !lines.some(line => line.id.toLowerCase() === item.id.toLowerCase()))) throw new Error("Match every unbilled received line once")
  const variances: string[] = []
  const exceeds = (actual: number, baseline: number) => BigInt(Math.abs(actual - baseline)) * BigInt(10000) > BigInt(baseline) * BigInt(options.toleranceBps)
  const amounts = lines.map(line => {
    const baseline = expected.find(item => item.id.toLowerCase() === line.id.toLowerCase())
    const po = purchaseLines.find(item => item.id.toLowerCase() === line.id.toLowerCase())
    if (!baseline || !po || baseline.quantity !== line.expected_quantity) throw new Error("Receipt changed, reload")
    const amount = serviceLineAmount(line.quantity, line.unit_cost_satang)
    if (exceeds(Math.round(line.quantity * 1000), Math.round(baseline.quantity * 1000))) variances.push(`Quantity: ${line.id}`)
    if (exceeds(line.unit_cost_satang, po.unit_cost_satang)) variances.push(`Price: ${line.id}`)
    // Preserve the PO's cumulative rounding when the vendor accepts its default line.
    return line.quantity === baseline.quantity && line.unit_cost_satang === po.unit_cost_satang
      ? serviceLineAmount(Number((po.billed_quantity + baseline.quantity).toFixed(3)), po.unit_cost_satang) - (po.billed_quantity ? serviceLineAmount(po.billed_quantity, po.unit_cost_satang) : 0)
      : amount
  })
  const subtotal = sumSatang(amounts)
  const calculatedVat = rounded(BigInt(subtotal) * BigInt(rateBps), BigInt(10000))
  const vat = options.vat ?? calculatedVat
  const total = options.total ?? sumSatang([subtotal, vat])
  if (!safe(vat) || !safe(total) || total < vat) throw new Error("Invalid input VAT or vendor total")
  if (vat > subtotal || (rateBps === 0 && vat !== 0) || Math.abs(vat - calculatedVat) > Math.min(subtotal, 3 * lines.length)) throw new Error("Input VAT contradicts matched base and rate")
  if (total !== sumSatang([subtotal, vat])) throw new Error("Vendor total must equal matched base plus VAT")
  return { subtotal, vat, total, variances }
}
