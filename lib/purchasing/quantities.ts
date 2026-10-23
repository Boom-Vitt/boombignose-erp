import { sumSatang } from "@/lib/money"
import { serviceLineAmount } from "@/lib/workflows/service"

export type PurchaseLine = {
  id: string
  quantity: number
  received_quantity: number
  returned_quantity?: number
  billed_quantity: number
  unit_cost_satang: number
}
export type ReceiptLine = { id: string; received_quantity: number; previous_received_quantity: number }

export function purchaseTotal(lines: Pick<PurchaseLine, "quantity" | "unit_cost_satang">[]): number {
  return sumSatang(lines.map(line => serviceLineAmount(line.quantity, line.unit_cost_satang)))
}

/** Validates cumulative received totals without mutating the purchase lines. */
export function applyReceipt(lines: PurchaseLine[], receipt: ReceiptLine[], tolerancePercent = 0): ReceiptLine[] {
  if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100 || Math.abs(tolerancePercent * 100 - Math.round(tolerancePercent * 100)) > 0.00001) throw new Error("Invalid receipt tolerance")
  const tolerance = BigInt(10000 + Math.round(tolerancePercent * 100))
  const targets = new Map<string, number>()
  for (const target of receipt) {
    const line = lines.find(line => line.id === target.id)
    if (!line || targets.has(target.id)) throw new Error("Unknown or duplicate receipt line")
    if (target.previous_received_quantity !== line.received_quantity) throw new Error("Receipt changed, reload")
    const quantity = target.received_quantity
    if (quantity !== 0) serviceLineAmount(quantity, 0)
    if (!Number.isFinite(quantity) || quantity < line.received_quantity || BigInt(Math.round(quantity * 1000)) * 10000n > BigInt(Math.round(line.quantity * 1000)) * tolerance) {
      throw new Error("Received total must be between the previous receipt and the allowed receipt quantity")
    }
    targets.set(target.id, quantity)
  }
  return lines.map(line => ({ id: line.id, received_quantity: targets.get(line.id) ?? line.received_quantity, previous_received_quantity: line.received_quantity }))
}

/** Difference of rounded cumulative amounts avoids charging a rounding satang twice. */
export function billAmount(lines: Pick<PurchaseLine, "received_quantity" | "returned_quantity" | "billed_quantity" | "unit_cost_satang">[]): number {
  return sumSatang(lines.map(line => {
    if (line.billed_quantity < 0 || line.billed_quantity > line.received_quantity) throw new Error("Invalid billed quantity")
    const returned = line.returned_quantity ?? 0
    if (returned < 0 || returned > line.received_quantity) throw new Error("Invalid returned quantity")
    if (line.received_quantity !== 0) serviceLineAmount(line.received_quantity, 0)
    if (returned !== 0) serviceLineAmount(returned, 0)
    const net = (Math.round(line.received_quantity * 1000) - Math.round(returned * 1000)) / 1000
    const received = net === 0 ? 0 : serviceLineAmount(net, line.unit_cost_satang)
    const billed = line.billed_quantity === 0 ? 0 : serviceLineAmount(line.billed_quantity, line.unit_cost_satang)
    return Math.max(0, received - billed)
  }))
}

export function hasUnbilledQuantities(lines: Pick<PurchaseLine, "received_quantity" | "returned_quantity" | "billed_quantity">[]): boolean {
  return lines.some(line => Math.round(line.received_quantity * 1000) - Math.round((line.returned_quantity ?? 0) * 1000) > Math.round(line.billed_quantity * 1000))
}
