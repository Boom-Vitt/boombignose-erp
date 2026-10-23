import { z } from "zod"
import type { Tables } from "@/lib/types/database"
import { serviceQuantityInput } from "@/lib/workflows/service"

const identity = z.guid().transform(id => id.toLowerCase())
const billLines = z.array(z.object({ id: identity, expected_quantity: serviceQuantityInput })).min(1)
const creditLines = z.array(z.object({ id: identity, quantity: serviceQuantityInput, original_bill_id: identity.optional() })).min(1)
type Match = Pick<Tables<"vendor_bill_matches">, "id" | "kind" | "vendor_reference" | "original_bill_id" | "lines">
type Cost = Pick<Tables<"costs">, "vendor_bill_match_id" | "purchase_cost_kind" | "input_vat_rate">
type Line = Pick<Tables<"purchase_order_items">, "id" | "description" | "returned_quantity" | "billed_quantity">
const thousandths = (quantity: number) => Math.round(quantity * 1000)

export function creditableBillLines(matches: Match[], costs: Cost[], lines: Line[]) {
  const originals = matches.filter(match => match.kind === "bill").map(match => {
    const parsed = billLines.safeParse(match.lines)
    const rates = costs.filter(cost => cost.purchase_cost_kind === "bill" && cost.vendor_bill_match_id?.toLowerCase() === match.id.toLowerCase()).map(cost => cost.input_vat_rate)
    if (!parsed.success || new Set(parsed.data.map(line => line.id)).size !== parsed.data.length || !rates.length || rates.some(rate => rate !== rates[0])) throw new Error("Vendor bill line evidence needs reconciliation")
    return { id: match.id.toLowerCase(), vendor_reference: match.vendor_reference, input_vat_rate: rates[0], lines: parsed.data }
  })
  const credits = matches.filter(match => match.kind === "credit").flatMap(match => {
    const parsed = creditLines.safeParse(match.lines)
    if (!parsed.success) throw new Error("Vendor credit line evidence needs reconciliation")
    return parsed.data.map(line => {
      const original = line.original_bill_id ?? match.original_bill_id?.toLowerCase()
      if (!original || !originals.some(bill => bill.id === original && bill.lines.some(item => item.id === line.id))) throw new Error("Vendor credit line evidence needs reconciliation")
      return { ...line, original_bill_id: original }
    })
  })
  return originals.flatMap(bill => {
    const available = bill.lines.flatMap(matched => {
      const item = lines.find(line => line.id.toLowerCase() === matched.id)
      if (!item) throw new Error("Vendor bill line evidence needs reconciliation")
      const previous = credits.filter(line => line.id === matched.id)
      const remaining = thousandths(matched.expected_quantity) - previous.filter(line => line.original_bill_id === bill.id).reduce((sum, line) => sum + thousandths(line.quantity), 0)
      const totalBilled = originals.flatMap(original => original.lines).filter(line => line.id === matched.id).reduce((sum, line) => sum + thousandths(line.expected_quantity), 0)
      const returned = Math.min(thousandths(item.returned_quantity), totalBilled - thousandths(item.billed_quantity)) - previous.reduce((sum, line) => sum + thousandths(line.quantity), 0)
      const maximum = Math.min(remaining, returned)
      return maximum > 0 ? [{ id: matched.id, description: item.description, remaining_quantity: remaining / 1000, maximum_quantity: maximum / 1000 }] : []
    })
    return available.length ? [{ original_bill_id: bill.id, vendor_reference: bill.vendor_reference, input_vat_rate: bill.input_vat_rate, lines: available }] : []
  })
}
