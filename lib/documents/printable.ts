import { formatTHB, type Satang } from "@/lib/money"

/**
 * Pure renderer for a printable invoice/quote document. Returns a self-contained
 * HTML string (inline CSS, print-friendly) that a route handler serves; the user
 * prints it to PDF from the browser. No PDF binary dependency — keeps the build
 * light and the output easy to unit-test. All interpolated text is HTML-escaped.
 */

export type DocLineItem = {
  description: string
  quantity: number
  unit?: string | null
  unit_price_satang: Satang
  amount_satang: Satang
}

export type PrintableDocument = {
  /** "Invoice" or "Quotation" — the document heading. */
  kind: string
  number: string
  status: string
  orgName: string
  sellerAddress?: string | null
  sellerTaxId?: string | null
  sellerBranch?: string | null
  buyerBranch?: string | null
  vatSatang?: Satang
  vatByRate?: { rateBps: number; vatSatang: number }[]
  whtSatang?: Satang
  whtRateBps?: number
  amountDueSatang?: Satang
  pricesIncludeVat?: boolean
  buyerAddress?: string | null
  buyerTaxId?: string | null
  clientName: string
  issueDate: string | null
  /** Invoices: due date. Quotes: leave undefined. */
  dueDate?: string | null
  /** Quotes: valid-until date. Invoices: leave undefined. */
  validUntil?: string | null
  items: DocLineItem[]
  subtotalSatang: Satang
  discountSatang?: Satang
  totalSatang: Satang
  verifiedPaidSatang?: Satang
  outstandingSatang?: Satang
  notes?: string | null
}

/** Escape the five HTML-significant characters. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Trim trailing zeros from a quantity for display (1.000 → "1", 1.500 → "1.5"). */
function fmtQty(quantity: number): string {
  return String(Number(quantity))
}

function metaRow(label: string, value: string | null | undefined): string {
  if (!value) return ""
  return `<div class="meta-row"><span class="meta-label">${escapeHtml(
    label
  )}</span><span>${escapeHtml(value)}</span></div>`
}

export function renderDocumentHtml(doc: PrintableDocument): string {
  const rows = doc.items
    .map(
      (it) => `<tr>
      <td>${escapeHtml(it.description)}</td>
      <td class="num">${escapeHtml(fmtQty(it.quantity))}${it.unit ? ` ${escapeHtml(it.unit)}` : ""}</td>
      <td class="num">${escapeHtml(formatTHB(it.unit_price_satang))}</td>
      <td class="num">${escapeHtml(formatTHB(it.amount_satang))}</td>
    </tr>`
    )
    .join("\n")

  const emptyRow = `<tr><td colspan="4" class="muted">No line items.</td></tr>`

  const discountLine = `<div class="total-row"><span>ส่วนลด / Discount</span><span class="num">${escapeHtml(formatTHB(doc.discountSatang ? -doc.discountSatang : 0))}</span></div>`

  const notesBlock = doc.notes
    ? `<div class="notes"><div class="meta-label">Notes</div><p>${escapeHtml(
        doc.notes
      )}</p></div>`
    : ""

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.kind)} ${escapeHtml(doc.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; margin: 0; padding: 40px; }
  .doc { max-width: 720px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.02em; }
  .org { font-size: 15px; font-weight: 600; }
  .status { text-transform: uppercase; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: #3f3f46; border: 1px solid #d4d4d8; border-radius: 999px; padding: 4px 10px; }
  .meta { margin-bottom: 24px; font-size: 13px; }
  .meta-row { display: flex; gap: 12px; padding: 2px 0; }
  .meta-label { color: #71717a; min-width: 96px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { text-align: left; border-bottom: 2px solid #18181b; padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #3f3f46; }
  td { padding: 8px 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: #a1a1aa; text-align: center; padding: 16px; }
  .totals { margin-left: auto; width: 260px; margin-top: 8px; font-size: 14px; }
  .total-row { display: flex; justify-content: space-between; padding: 4px 6px; }
  .total-row.grand { border-top: 2px solid #18181b; margin-top: 6px; padding-top: 10px; font-weight: 700; font-size: 16px; }
  .notes { margin-top: 32px; font-size: 13px; }
  .notes p { margin: 4px 0 0; white-space: pre-wrap; }
  footer { margin-top: 48px; font-size: 11px; color: #a1a1aa; text-align: center; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="doc">
    <header>
      <div>
        <h1>${escapeHtml(doc.kind)}</h1>
        <div class="org">${escapeHtml(doc.orgName)}</div>
      </div>
      <div class="status">${escapeHtml(doc.status)}</div>
    </header>

    <div class="meta">
      ${metaRow("ผู้ขาย / Seller address", doc.sellerAddress)}
      ${metaRow("เลขผู้เสียภาษีผู้ขาย / Seller tax ID", doc.sellerTaxId)}
      ${metaRow("Seller branch", doc.sellerBranch)}
      ${metaRow("Buyer branch", doc.buyerBranch)}
      ${metaRow("เลขที่ / Number", doc.number)}
      ${metaRow("ลูกค้า / Bill to", doc.clientName)}
      ${metaRow("ที่อยู่ลูกค้า / Buyer address", doc.buyerAddress)}
      ${metaRow("เลขผู้เสียภาษีลูกค้า / Buyer tax ID", doc.buyerTaxId)}
      ${metaRow("วันที่ / Issue date", doc.issueDate)}
      ${metaRow("ครบกำหนด / Due date", doc.dueDate)}
      ${metaRow("ใช้ได้ถึง / Valid until", doc.validUntil)}
    </div>

    <table>
      <thead>
        <tr>
          <th>รายละเอียด / Description</th>
          <th class="num">จำนวน / Qty</th>
          <th class="num">ราคาต่อหน่วย / Unit price</th>
          <th class="num">จำนวนเงิน / Amount</th>
        </tr>
      </thead>
      <tbody>
        ${doc.items.length ? rows : emptyRow}
      </tbody>
    </table>

    <div class="totals">
      <div class="total-row"><span>รวมรายการ / Subtotal</span><span class="num">${escapeHtml(
        formatTHB(doc.subtotalSatang)
      )}</span></div>
      ${discountLine}
      ${(doc.vatByRate?.filter(rate => rate.rateBps > 0).length ? doc.vatByRate.filter(rate => rate.rateBps > 0).map(rate => `<div class="total-row"><span>VAT ${rate.rateBps / 100}%</span><span class="num">${escapeHtml(formatTHB(rate.vatSatang))}</span></div>`).join("") : `<div class="total-row"><span>VAT</span><span class="num">${escapeHtml(formatTHB(doc.vatSatang ?? 0))}</span></div>`)}
      <div class="total-row grand"><span>รวมทั้งสิ้น / Total</span><span class="num">${escapeHtml(
        formatTHB(doc.totalSatang)
      )}</span></div>
      <div class="total-row"><span>WHT ${(doc.whtRateBps ?? 0) / 100}%</span><span class="num">${escapeHtml(formatTHB(-(doc.whtSatang ?? 0)))}</span></div>
      <div class="total-row grand"><span>Amount due</span><span class="num">${escapeHtml(formatTHB(doc.amountDueSatang ?? doc.totalSatang))}</span></div>
      ${doc.pricesIncludeVat ? '<p>Entered prices and discounts include VAT.</p>' : ""}
      ${doc.verifiedPaidSatang !== undefined ? `<div class="total-row"><span>รับเงินที่ตรวจสอบแล้ว / Verified receipts</span><span class="num">${escapeHtml(formatTHB(doc.verifiedPaidSatang))}</span></div>` : ""}
      ${doc.outstandingSatang !== undefined ? `<div class="total-row"><span>ยอดคงค้าง / Outstanding</span><span class="num">${escapeHtml(formatTHB(doc.outstandingSatang))}</span></div>` : ""}
    </div>

    ${notesBlock}

    <footer>เอกสารเพื่อการดำเนินงาน · Operational document, not a legal tax invoice. VAT and withholding treatment require accountant review.</footer>
  </div>
</body>
</html>`
}
