import { sumSatang } from "@/lib/money"
import { serviceLineAmount } from "@/lib/workflows/service"

export type PurchaseLine = {
  id: string
  quantity: number
  received_quantity: number
  billed_quantity: number
  unit_cost_satang: number
}
export type ReceiptLine = { id: string; received_quantity: number }

export function purchaseTotal(lines: Pick<PurchaseLine, "quantity" | "unit_cost_satang">[]): number {
  return sumSatang(lines.map(line => serviceLineAmount(line.quantity, line.unit_cost_satang)))
}

/** Validates cumulative received totals without mutating the purchase lines. */
export function applyReceipt(lines: PurchaseLine[], receipt: ReceiptLine[]): ReceiptLine[] {
  const targets = new Map<string, number>()
  for (const target of receipt) {
    const line = lines.find(line => line.id === target.id)
    if (!line || targets.has(target.id)) throw new Error("Unknown or duplicate receipt line")
    const quantity = target.received_quantity
    if (quantity !== 0) serviceLineAmount(quantity, 0)
    if (!Number.isFinite(quantity) || quantity < line.received_quantity || quantity > line.quantity) {
      throw new Error("Received total must be between the previous receipt and the ordered quantity")
    }
    targets.set(target.id, quantity)
  }
  return lines.map(line => ({ id: line.id, received_quantity: targets.get(line.id) ?? line.received_quantity }))
}

/** Difference of rounded cumulative amounts avoids charging a rounding satang twice. */
export function billAmount(lines: Pick<PurchaseLine, "received_quantity" | "billed_quantity" | "unit_cost_satang">[]): number {
  return sumSatang(lines.map(line => {
    if (line.billed_quantity < 0 || line.billed_quantity > line.received_quantity) throw new Error("Invalid billed quantity")
    const received = line.received_quantity === 0 ? 0 : serviceLineAmount(line.received_quantity, line.unit_cost_satang)
    const billed = line.billed_quantity === 0 ? 0 : serviceLineAmount(line.billed_quantity, line.unit_cost_satang)
    return received - billed
  }))
}
