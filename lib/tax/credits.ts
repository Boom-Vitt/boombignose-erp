import { calculateTax } from "./totals"

export type CreditBucket = { rateBps: number; enteredSatang: number; vatSatang: number }

export function creditTax(buckets: readonly CreditBucket[], before: readonly number[], after: readonly number[], inclusive: boolean, whtRateBps: number) {
  if (before.length !== buckets.length || after.length !== buckets.length) throw new Error("Invalid credit buckets")
  let beforeBase = 0
  let afterBase = 0
  const vatByRate = buckets.map((bucket, index) => {
    const previous = before[index], next = after[index]
    if (![previous, next, bucket.enteredSatang, bucket.vatSatang].every(value => Number.isSafeInteger(value) && value >= 0) || next < previous || next > bucket.enteredSatang) throw new Error("Credit exceeds original bucket")
    const remaining = (credited: number) => {
      const totals = calculateTax([{ amount_satang: bucket.enteredSatang - credited, tax_rate_bps: bucket.rateBps }], 0, inclusive, 0)
      const vat = credited === 0 ? bucket.vatSatang : totals.vatSatang
      return { vat, base: bucket.enteredSatang - credited - (inclusive ? vat : 0) }
    }
    const old = remaining(previous), current = remaining(next)
    beforeBase += old.base
    afterBase += current.base
    return { rateBps: bucket.rateBps, baseSatang: old.base - current.base, vatSatang: old.vat - current.vat }
  })
  const roundedWht = (base: number) => calculateTax([{ amount_satang: base, tax_rate_bps: 0 }], 0, false, whtRateBps).whtSatang
  const baseSatang = beforeBase - afterBase
  const vatSatang = vatByRate.reduce((sum, bucket) => sum + bucket.vatSatang, 0)
  const whtSatang = roundedWht(beforeBase) - roundedWht(afterBase)
  const totalSatang = baseSatang + vatSatang
  return { baseSatang, vatSatang, totalSatang, whtSatang, amountDueSatang: totalSatang - whtSatang, vatByRate }
}
