import type { Enums } from "@/lib/types/database"
import { serviceLineAmount } from "@/lib/workflows/service"

export const MOVE_SIGNS: Record<Enums<"stock_move_kind">, 1 | -1> = {
  receipt: 1, delivery: -1, adjustment_in: 1, adjustment_out: -1, transfer_in: 1, transfer_out: -1,
}

export function signedQuantity(kind: Enums<"stock_move_kind">, quantity: number) {
  serviceLineAmount(quantity, 0)
  return MOVE_SIGNS[kind] * quantity
}

function roundedDivide(value: bigint, divisor: bigint): bigint {
  return value < BigInt(0) ? -roundedDivide(-value, divisor) : (value + divisor / BigInt(2)) / divisor
}

/** Uses the ledger's thousandth quantities and ten-decimal average cost without float rounding. */
export function stockBalance(moves: { kind: Enums<"stock_move_kind">; quantity: number; unit_cost_satang: number }[]) {
  let quantity = BigInt(0)
  let average = BigInt(0)
  const costScale = BigInt(10_000_000_000)
  for (const move of moves) {
    const delta = BigInt(Math.round(signedQuantity(move.kind, move.quantity) * 1000))
    if (!Number.isSafeInteger(move.unit_cost_satang) || move.unit_cost_satang < 0) throw new Error("Invalid unit cost")
    const cost = BigInt(move.unit_cost_satang) * costScale
    if (delta > BigInt(0) && !(move.kind === "adjustment_in" && quantity > BigInt(0))) average = quantity <= BigInt(0) ? cost : roundedDivide(quantity * average + delta * cost, quantity + delta)
    quantity += delta
    if (quantity === BigInt(0)) average = BigInt(0)
  }
  const value = Number(roundedDivide(quantity * average, BigInt(1000) * costScale))
  if (!Number.isSafeInteger(value)) throw new Error("Stock value exceeds safe satang bounds")
  if (!Number.isSafeInteger(Number(quantity))) throw new Error("Stock quantity exceeds safe precision")
  return { quantity: Number(quantity) / 1000, average_cost_satang: Number(roundedDivide(average, costScale)), value_satang: value }
}

export type ReplenishmentProduct = {
  id: string; name: string; quantity: number; reorder_min: number; reorder_qty: number; default_vendor_id: string | null
}

export function replenishmentGroups<T extends ReplenishmentProduct>(products: T[]) {
  const groups = new Map<string | null, T[]>()
  for (const product of products) {
    if (product.quantity >= product.reorder_min) continue
    const rows = groups.get(product.default_vendor_id) ?? []
    rows.push(product)
    groups.set(product.default_vendor_id, rows)
  }
  return [...groups].map(([vendorId, products]) => ({ vendorId, products }))
}
