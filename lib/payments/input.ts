/** Exact decimal THB input; no binary-float multiplication or silent rounding. */
export function paymentAmount(value: string): number {
  const input = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a positive THB amount with up to two decimals")
  const [whole, fraction = ""] = input.split(".")
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))
  if (amount <= BigInt(0) || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount outside safe satang bounds")
  return Number(amount)
}
