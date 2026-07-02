import type { Enums } from "@/lib/types/database"
import type { RecurringInterval } from "./recurring"

/**
 * Pure helpers for turning a subscription into a concrete invoice row. Shared by
 * the manual "Generate invoice now" action and the cron endpoint so both emit an
 * identical invoice shape. No I/O — callers do the insert and advance the run
 * date via `nextRunAfter`.
 */

/** Build a stable, human invoice number for a subscription run: "Name-YYYYMM". */
export function invoiceNumberFor(subName: string, dateISO: string): string {
  const yyyymm = `${dateISO.slice(0, 4)}${dateISO.slice(5, 7)}`
  return `${subName}-${yyyymm}`
}

/** Minimal subscription fields needed to generate an invoice. */
export type GeneratableSubscription = {
  org_id: string
  client_id: string
  project_id: string | null
  name: string
  amount_satang: number
  interval: RecurringInterval
}

export type GeneratedInvoice = {
  org_id: string
  client_id: string
  project_id: string | null
  number: string
  status: Enums<"invoice_status">
  amount_satang: number
  is_recurring: boolean
  recurring_interval: RecurringInterval
  issue_date: string
}

/** Build the invoice `insert` payload for a subscription run on `todayISO`. */
export function buildGeneratedInvoice(
  sub: GeneratableSubscription,
  todayISO: string
): GeneratedInvoice {
  return {
    org_id: sub.org_id,
    client_id: sub.client_id,
    project_id: sub.project_id,
    number: invoiceNumberFor(sub.name, todayISO),
    status: "sent",
    amount_satang: sub.amount_satang,
    is_recurring: true,
    recurring_interval: sub.interval,
    issue_date: todayISO,
  }
}
