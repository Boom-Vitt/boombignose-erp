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
  if (!Number.isFinite(baht)) throw new Error("Money must be finite")
  const negative = baht < 0
  const [mantissa, exponent = "0"] = String(Math.abs(baht)).toLowerCase().split("e")
  const [whole, fraction = ""] = mantissa.split(".")
  const coefficient = BigInt(whole + fraction)
  const scale = fraction.length - Number(exponent) - 2
  const power = BigInt(10) ** BigInt(Math.abs(scale))
  // Exact decimal rounding; a half satang rounds away from zero.
  const absolute = scale <= 0 ? coefficient * power : (coefficient + power / BigInt(2)) / power
  const result = Number(negative ? -absolute : absolute)
  if (!Number.isSafeInteger(result)) throw new Error("Money exceeds safe satang bounds")
  return result
}

/** Convert integer satang to a baht number. For display/aggregation only. */
export function satangToBaht(satang: Satang): number {
  return satang / SATANG_PER_BAHT
}

/** Safe integer sum of satang amounts. */
export function sumSatang(amounts: Satang[]): Satang {
  return amounts.reduce((acc, n) => {
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(acc + n)) throw new Error("Unsafe integer-satang sum")
    return acc + n
  }, 0)
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
  if (!Number.isSafeInteger(satang)) throw new Error("Invalid integer satang")
  const absolute = BigInt(Math.abs(satang))
  const whole = absolute / BigInt(100)
  const fraction = String(absolute % BigInt(100)).padStart(2, "0")
  const signedWhole = satang < 0 ? -whole : whole
  const value = satang < 0 && whole === BigInt(0) ? -0 : signedWhole
  return thbFull.formatToParts(value).map(part => part.type === "fraction" ? fraction : part.value).join("")
}

/** Exact decimal text for forms and CSV; Number division can lose a satang. */
export function satangToBahtString(satang: Satang): string {
  if (!Number.isSafeInteger(satang)) throw new Error("Invalid integer satang")
  const absolute = BigInt(Math.abs(satang))
  return `${satang < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`
}

/** Format integer satang with no decimals: 123456 -> "฿1,235". */
export function formatTHBWhole(satang: Satang): string {
  if (!Number.isSafeInteger(satang)) throw new Error("Invalid integer satang")
  const rounded = (BigInt(Math.abs(satang)) + BigInt(50)) / BigInt(100)
  return thbWhole.format(satang < 0 ? -rounded : rounded)
}

/** Compact format for dashboard cards: 1234567890 -> "฿12.3M". */
export function formatTHBCompact(satang: Satang): string {
  return thbCompact.format(satangToBaht(satang))
}
