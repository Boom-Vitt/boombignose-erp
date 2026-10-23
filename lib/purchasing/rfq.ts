import { escapeHtml } from "@/lib/email/render"
import { interleave, type ServerSection } from "@/lib/line-grid/grid"
import { formatTHB } from "@/lib/money"
import { serviceLineAmount } from "@/lib/workflows/service"
import { purchaseTotal } from "./quantities"

export function renderRFQEmail(input: {
  number: string
  vendorName: string
  orderDate: string
  expectedDate: string | null
  notes: string | null
  lines: { description: string; quantity: number; unit: string; unit_cost_satang: number }[]
  sections?: ServerSection[]
}): string {
  const rows = interleave(input.lines, input.sections ?? []).map(row => "lines_before" in row
    ? `<tr><td colspan="4" style="white-space:pre-wrap${row.kind === "section" ? ";font-weight:bold" : ""}">${escapeHtml(row.description)}</td></tr>`
    : `<tr><td>${escapeHtml(row.description)}</td><td>${row.quantity} ${escapeHtml(row.unit)}</td><td>${escapeHtml(formatTHB(row.unit_cost_satang))}</td><td>${escapeHtml(formatTHB(serviceLineAmount(row.quantity, row.unit_cost_satang)))}</td></tr>`).join("")
  return `<div style="font-family:Arial,sans-serif;line-height:1.5"><p>Dear ${escapeHtml(input.vendorName)},</p>
<h1>Request for quotation ${escapeHtml(input.number)}</h1><p>Please confirm availability and pricing for these requested items.</p>
<p>Order date: ${escapeHtml(input.orderDate)}${input.expectedDate ? `<br>Expected arrival: ${escapeHtml(input.expectedDate)}` : ""}</p>
<table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse"><thead><tr><th>Description</th><th>Quantity</th><th>Unit cost</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<p>Total: <strong>${escapeHtml(formatTHB(purchaseTotal(input.lines)))}</strong></p>
${input.notes ? `<p style="white-space:pre-wrap">${escapeHtml(input.notes)}</p>` : ""}<p>Sent from BoomBigNose ERP.</p></div>`
}
