export type TaxLine = { amount_satang: number; tax_rate_bps: number }
export type TaxTotals = {
  subtotalSatang: number
  discountSatang: number
  baseSatang: number
  vatSatang: number
  totalSatang: number
  whtSatang: number
  amountDueSatang: number
  vatByRate: { rateBps: number; baseSatang: number; vatSatang: number }[]
}

export const WHT_RATES = [0, 100, 200, 300, 500] as const

function safe(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid satang amount")
  return BigInt(value)
}

function rate(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error("Invalid tax rate")
  return value
}

function money(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Total exceeds safe satang bounds")
  return Number(value)
}

const round = (numerator: bigint, denominator: bigint) => (numerator * BigInt(2) + denominator) / (denominator * BigInt(2))

/** Allocate discount by rate using largest remainders, then round VAT once per rate. */
export function calculateTax(lines: readonly TaxLine[], discountSatang = 0, pricesIncludeVat = false, whtRateBps = 0): TaxTotals {
  if (!(WHT_RATES as readonly number[]).includes(whtRateBps)) throw new Error("Invalid WHT rate")
  const grouped = new Map<number, bigint>()
  for (const line of lines) {
    const key = rate(line.tax_rate_bps)
    grouped.set(key, (grouped.get(key) ?? BigInt(0)) + safe(line.amount_satang))
  }
  const subtotal = [...grouped.values()].reduce((sum, amount) => sum + amount, BigInt(0))
  const discount = safe(discountSatang)
  if (discount > subtotal) throw new Error("Discount exceeds subtotal")
  const groups = [...grouped].map(([rateBps, amount]) => ({
    rateBps, amount,
    discount: subtotal ? discount * amount / subtotal : BigInt(0),
    remainder: subtotal ? discount * amount % subtotal : BigInt(0),
  })).sort((a, b) => a.remainder === b.remainder ? a.rateBps - b.rateBps : a.remainder > b.remainder ? -1 : 1)
  let remaining = discount - groups.reduce((sum, group) => sum + group.discount, BigInt(0))
  for (const group of groups) {
    if (remaining > BigInt(0)) { group.discount++; remaining-- }
  }
  let base = BigInt(0)
  let vat = BigInt(0)
  const vatByRate = groups.sort((a, b) => a.rateBps - b.rateBps).map(group => {
    const net = group.amount - group.discount
    const tax = round(net * BigInt(group.rateBps), pricesIncludeVat ? BigInt(10000) + BigInt(group.rateBps) : BigInt(10000))
    const taxable = pricesIncludeVat ? net - tax : net
    base += taxable
    vat += tax
    return { rateBps: group.rateBps, baseSatang: money(taxable), vatSatang: money(tax) }
  })
  const total = base + vat
  const wht = round(base * BigInt(whtRateBps), BigInt(10000))
  return { subtotalSatang: money(subtotal), discountSatang, baseSatang: money(base), vatSatang: money(vat), totalSatang: money(total), whtSatang: money(wht), amountDueSatang: money(total - wht), vatByRate }
}
