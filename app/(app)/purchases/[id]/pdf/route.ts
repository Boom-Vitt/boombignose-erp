import { requireOrgContext } from "@/lib/auth"
import { renderDocumentHtml } from "@/lib/documents/printable"
import { purchaseDetail } from "@/lib/purchasing/queries"
import { purchaseTotal } from "@/lib/purchasing/quantities"
import { serviceLineAmount } from "@/lib/workflows/service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext()
  const { order, lines } = await purchaseDetail((await params).id)
  const total = purchaseTotal(lines)
  return new Response(renderDocumentHtml({
    kind: ["draft", "sent"].includes(order.status) ? "Request for quotation" : "Purchase order",
    number: order.number, status: order.status, orgName: ctx.orgName, clientName: order.vendors?.name ?? "Vendor",
    buyerAddress: order.vendors?.address, buyerTaxId: order.vendors?.tax_id, issueDate: order.order_date,
    notes: order.notes, subtotalSatang: total, totalSatang: total,
    items: lines.map(line => ({ description: `${line.description} (${line.unit})`, quantity: line.quantity, unit_price_satang: line.unit_cost_satang, amount_satang: serviceLineAmount(line.quantity, line.unit_cost_satang) })),
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } })
}
