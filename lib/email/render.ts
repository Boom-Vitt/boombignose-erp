/**
 * Pure email builders. NO I/O, NO server-only imports, NO SDK — safe to
 * unit-test in node with no API key and no network. Money stays satang and is
 * formatted through the shared `lib/money` helpers at the display edge.
 */
import { formatTHB } from "@/lib/money"

/** Minimal HTML escaping so client/document values can't break the markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type InvoiceEmailInput = {
  number: string
  clientName: string | null
  amountSatang: number
  pdfUrl: string
  dueDate?: string | null
}

export type QuoteEmailInput = {
  number: string
  clientName: string | null
  totalSatang: number
  pdfUrl: string
  validUntil?: string | null
}

export function invoiceEmailSubject(number: string): string {
  return `Invoice ${number}`
}

export function quoteEmailSubject(number: string): string {
  return `Quote ${number}`
}

/** Shared, inline-styled shell so the message renders in any email client. */
function emailShell(bodyHtml: string): string {
  return [
    `<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.5;">`,
    bodyHtml,
    `<p style="color: #888; font-size: 12px; margin-top: 24px;">Sent from BoomBigNose Company OS.</p>`,
    `</div>`,
  ].join("")
}

function ctaButton(pdfUrl: string, label: string): string {
  return (
    `<p style="margin: 20px 0;">` +
    `<a href="${escapeHtml(pdfUrl)}" ` +
    `style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">` +
    `${escapeHtml(label)}</a></p>`
  )
}

export function renderInvoiceEmailHtml(input: InvoiceEmailInput): string {
  const greeting = input.clientName
    ? `Dear ${escapeHtml(input.clientName)},`
    : "Hello,"
  const due = input.dueDate
    ? `<p>Payment is due by <strong>${escapeHtml(input.dueDate)}</strong>.</p>`
    : ""
  const body = [
    `<p>${greeting}</p>`,
    `<p>Please find invoice <strong>${escapeHtml(input.number)}</strong> for ` +
      `<strong>${escapeHtml(formatTHB(input.amountSatang))}</strong>.</p>`,
    due,
    ctaButton(input.pdfUrl, "View invoice PDF"),
    `<p>Thank you for your business.</p>`,
  ].join("")
  return emailShell(body)
}

export function renderQuoteEmailHtml(input: QuoteEmailInput): string {
  const greeting = input.clientName
    ? `Dear ${escapeHtml(input.clientName)},`
    : "Hello,"
  const valid = input.validUntil
    ? `<p>This quote is valid until <strong>${escapeHtml(input.validUntil)}</strong>.</p>`
    : ""
  const body = [
    `<p>${greeting}</p>`,
    `<p>Please find quote <strong>${escapeHtml(input.number)}</strong> for ` +
      `<strong>${escapeHtml(formatTHB(input.totalSatang))}</strong>.</p>`,
    valid,
    ctaButton(input.pdfUrl, "View quote PDF"),
    `<p>We look forward to working with you.</p>`,
  ].join("")
  return emailShell(body)
}
