export type Allocation = { invoiceId: string; amountSatang: number }

export function allocationRemainder(receiptSatang: number, allocations: readonly Allocation[]): number {
  if (!Number.isSafeInteger(receiptSatang) || receiptSatang <= 0) throw new Error("Invalid receipt amount")
  const seen = new Set<string>()
  let total = BigInt(0)
  for (const allocation of allocations) {
    if (seen.has(allocation.invoiceId) || !Number.isSafeInteger(allocation.amountSatang) || allocation.amountSatang <= 0) throw new Error("Invalid or duplicate allocation")
    seen.add(allocation.invoiceId)
    total += BigInt(allocation.amountSatang)
  }
  if (total > BigInt(receiptSatang)) throw new Error("Allocations exceed receipt")
  return receiptSatang - Number(total)
}
