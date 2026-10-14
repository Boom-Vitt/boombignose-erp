/** Exact decimal THB input; no binary-float multiplication or silent rounding. */
export function paymentAmount(value: string): number {
  const amount = moneyInput(value)
  if (amount === 0) throw new Error("Enter a positive payment amount")
  return amount
}

/** Exact nonnegative THB input for draft invoices, prices and costs. */
export function moneyInput(value: string): number {
  const input = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a positive THB amount with up to two decimals")
  const [whole, fraction = ""] = input.split(".")
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount outside safe satang bounds")
  return Number(amount)
}

/** Matches Postgres numeric quantity * integer price, rounded half up once. */
export function invoiceLineAmount(quantity: string, priceSatang: number): number {
  if (!Number.isSafeInteger(priceSatang) || priceSatang < 0) throw new Error("Invalid price")
  const input = quantity.trim()
  if (!/^\d+(\.\d{1,3})?$/.test(input)) throw new Error("Quantity must have at most three decimals")
  const [whole, fraction = ""] = input.split(".")
  const milli = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"))
  if (milli <= BigInt(0) || milli > BigInt("999999999999")) throw new Error("Quantity outside bounds")
  const result = (milli * BigInt(priceSatang) + BigInt(500)) / BigInt(1000)
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Line total outside safe satang bounds")
  return Number(result)
}
