/**
 * Money is stored EVERYWHERE as integer minor units (satang). 100 satang = 1 THB.
 *
 * Rules:
 *  - Never store or compute money as a float. Columns are `bigint` satang.
 *  - Convert baht <-> satang only at the edges (form input / display).
 *  - Every module imports these helpers; do not hand-roll satang <-> baht.
 */

/** Integer satang. e.g. 12345 === ฿123.45 */
export type Satang = number

export const SATANG_PER_BAHT = 100

/** Convert a baht amount (possibly fractional user input) to integer satang. */
export function bahtToSatang(baht: number): Satang {
  return Math.round(baht * SATANG_PER_BAHT)
}

/** Convert integer satang to a baht number. For display/aggregation only. */
export function satangToBaht(satang: Satang): number {
  return satang / SATANG_PER_BAHT
}

/** Safe integer sum of satang amounts. */
export function sumSatang(amounts: Satang[]): Satang {
  return amounts.reduce((acc, n) => acc + n, 0)
}

const thbFull = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const thbWhole = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const thbCompact = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  notation: "compact",
  maximumFractionDigits: 1,
})

/** Format integer satang as Thai Baht: 123456 -> "฿1,234.56". */
export function formatTHB(satang: Satang): string {
  return thbFull.format(satangToBaht(satang))
}

/** Format integer satang with no decimals: 123456 -> "฿1,235". */
export function formatTHBWhole(satang: Satang): string {
  return thbWhole.format(satangToBaht(satang))
}

/** Compact format for dashboard cards: 1234567890 -> "฿12.3M". */
export function formatTHBCompact(satang: Satang): string {
  return thbCompact.format(satangToBaht(satang))
}
