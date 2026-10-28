import { withBuddhistEra } from "@/lib/dates"
import { formatTHB } from "@/lib/money"

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** Working copy of a 50 ทวิ certificate. The payer issues the statutory form. */
export type WhtCertificateDraft = {
  reference: string
  issueDate: string | null
  payerName: string
  payerAddress: string | null
  payerTaxId: string | null
  payeeName: string
  payeeAddress: string | null
  payeeTaxId: string | null
  income: string
  baseSatang: number
  whtSatang: number
  whtRateBps: number
}

function text(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ""
  return escapeHtml(trimmed || "—")
}

/** HTML draft. Refuses a document that withheld nothing. */
export function renderWhtCertificate(draft: WhtCertificateDraft): string {
  if (!Number.isSafeInteger(draft.baseSatang) || draft.baseSatang < 0) throw new Error("Invalid income amount")
  if (!Number.isSafeInteger(draft.whtSatang) || draft.whtSatang <= 0) throw new Error("No withholding to certify")
  if (!Number.isInteger(draft.whtRateBps) || draft.whtRateBps <= 0 || draft.whtRateBps > 10000) throw new Error("Invalid withholding rate")
  const rate = `${draft.whtRateBps / 100}%`
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>ร่าง 50 ทวิ ${escapeHtml(draft.reference)}</title>
<style>
  body { font-family: sans-serif; margin: 2rem; color: #111; }
  .banner { border: 2px solid #111; padding: 0.75rem 1rem; font-weight: 700; }
  h1 { font-size: 1.25rem; }
  dt { color: #444; }
  dd { margin: 0 0 0.75rem; }
</style>
</head>
<body>
<p class="banner">DRAFT / ร่าง — ไม่ใช่แบบของกรมสรรพากร และไม่ใช่หนังสือรับรองตามกฎหมาย ผู้จ่ายเงินเป็นผู้ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย เอกสารนี้คัดจากใบแจ้งหนี้เพื่อการดำเนินงาน</p>
<h1>ร่างหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)</h1>
<p>ประเภทเงินได้และแบบ ภ.ง.ด. ไม่ได้ถูกเลือกที่นี่</p>
<dl>
  <dt>อ้างอิงเอกสารดำเนินงาน</dt><dd>${text(draft.reference)}</dd>
  <dt>วันที่เอกสาร</dt><dd>${text(draft.issueDate ? withBuddhistEra(draft.issueDate) : null)}</dd>
  <dt>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย / Payer</dt><dd>${text(draft.payerName)}<br />${text(draft.payerAddress)}<br />เลขประจำตัวผู้เสียภาษี ${text(draft.payerTaxId)}</dd>
  <dt>ผู้ถูกหักภาษี ณ ที่จ่าย / Payee</dt><dd>${text(draft.payeeName)}<br />${text(draft.payeeAddress)}<br />เลขประจำตัวผู้เสียภาษี ${text(draft.payeeTaxId)}</dd>
  <dt>เงินได้ตามเอกสาร</dt><dd>${text(draft.income)}</dd>
  <dt>ฐานเงินได้ก่อนหักภาษี</dt><dd>${escapeHtml(formatTHB(draft.baseSatang))}</dd>
  <dt>อัตราที่คำนวณในเอกสาร</dt><dd>${escapeHtml(rate)}</dd>
  <dt>ภาษีที่หักตามเอกสาร</dt><dd>${escapeHtml(formatTHB(draft.whtSatang))}</dd>
</dl>
</body>
</html>`
}
