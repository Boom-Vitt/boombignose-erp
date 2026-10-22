import type { Tables } from "@/lib/types/database"

export const RECORD_TYPES = ["client", "deal", "quote", "invoice", "project", "subscription", "vendor", "purchase_order"] as const
export type RecordType = typeof RECORD_TYPES[number]
export type RecordRef = { recordType: RecordType; recordId: string }
export const RECORD_TABLES = {
  vendor: "vendors", purchase_order: "purchase_orders",
  client: "clients", deal: "deals", quote: "quotes", invoice: "invoices", project: "projects", subscription: "subscriptions",
} as const
const RECORD_ROUTES = {
  vendor: "/vendors", purchase_order: "/purchases",
  client: "/clients", deal: "/deals", quote: "/quotes", invoice: "/finance/invoices", project: "/projects", subscription: "/finance/subscriptions",
} as const
export function recordHref(recordType: RecordType, recordId: string): string {
  return `${RECORD_ROUTES[recordType]}/${recordId}`
}
export type Activity = Tables<"activities">
export const ACTIVITY_LABELS = { note: "Note", call: "Call", email: "Email", meeting: "Meeting", follow_up: "Follow-up" } as const
