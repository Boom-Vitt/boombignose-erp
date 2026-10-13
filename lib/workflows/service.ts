import type { Enums } from "@/lib/types/database"
import { z } from "zod"

type QuoteStatus = Enums<"quote_status">

export function quoteIsEditable(status: QuoteStatus): boolean {
  return status === "draft" || status === "sent"
}

/** Conversion is only available through the atomic DB command. */
export function quoteTransitionError(
  from: QuoteStatus,
  to: QuoteStatus,
  validUntil: string | null,
  today: string
): string | null {
  if (to === "converted") return "Use quote conversion to create the linked records."
  if (to === "accepted" && validUntil && validUntil < today) return "This quote has expired."
  if (from === to) return null
  if (from === "draft" && to === "sent") return null
  if (from === "sent" && ["accepted", "declined", "expired"].includes(to)) return null
  return `Cannot change a ${from} quote to ${to}.`
}

const MAX_SATANG = BigInt(Number.MAX_SAFE_INTEGER)

function safeSatang(amount: bigint): number {
  if (amount < BigInt(0) || amount > MAX_SATANG) throw new Error("Amount outside safe satang bounds")
  return Number(amount)
}

/** User-entered THB: reject extra decimals rather than silently rounding. */
export function serviceAmountSatang(value: string | number): number {
  const input = String(value).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a THB amount with up to two decimals")
  const [whole, fraction = ""] = input.split(".")
  return safeSatang(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")))
}

export function serviceAmountBaht(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) throw new Error("Invalid satang amount")
  const amount = BigInt(satang)
  return `${amount / BigInt(100)}.${String(amount % BigInt(100)).padStart(2, "0")}`
}

/** Mirrors PostgreSQL numeric(12,3) and round(quantity * unit_price_satang). */
export function serviceLineAmount(quantity: string | number, unitPriceSatang: number): number {
  const input = String(quantity).trim()
  if (!/^\d+(\.\d{1,3})?$/.test(input)) throw new Error("Enter a positive quantity with up to three decimals")
  const [whole, fraction = ""] = input.split(".")
  const thousandths = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"))
  if (thousandths <= BigInt(0) || thousandths > BigInt("999999999999")) {
    throw new Error("Quantity outside supported bounds")
  }
  if (!Number.isSafeInteger(unitPriceSatang) || unitPriceSatang < 0) throw new Error("Invalid unit price")
  return safeSatang((thousandths * BigInt(unitPriceSatang) + BigInt(500)) / BigInt(1000))
}

export const serviceMoneyInput = z.union([z.string(), z.number()]).refine((value) => {
  try { serviceAmountSatang(value); return true } catch { return false }
}, "Enter a safe, nonnegative THB amount with up to two decimals")

export const serviceQuantityInput = z.union([z.string(), z.number()]).refine((value) => {
  try { serviceLineAmount(value, 0); return true } catch { return false }
}, "Enter a positive quantity with up to three decimals").transform(Number)

/** Storage survives a refreshed page after an uncertain transport result. */
export function quoteConversionKey(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  newKey: () => string
): string {
  const storageKey = `quote-conversion:${scope}`
  let previous: string | null = null
  try { previous = storage.getItem(storageKey) } catch { /* Storage may be disabled. */ }
  if (previous && z.uuid().safeParse(previous).success) return previous
  const key = newKey()
  try { storage.setItem(storageKey, key) } catch { /* The caller retains the key in memory. */ }
  return key
}
