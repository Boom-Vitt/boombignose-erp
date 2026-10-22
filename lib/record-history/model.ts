import type { Tables } from "@/lib/types/database"

export const RECORD_TYPES = ["client", "deal", "quote", "invoice", "project", "subscription"] as const
export type RecordType = typeof RECORD_TYPES[number]
export type RecordRef = { recordType: RecordType; recordId: string }
export const RECORD_TABLES = {
  client: "clients", deal: "deals", quote: "quotes", invoice: "invoices", project: "projects", subscription: "subscriptions",
} as const
const RECORD_ROUTES = {
  client: "/clients", deal: "/deals", quote: "/quotes", invoice: "/finance/invoices", project: "/projects", subscription: "/finance/subscriptions",
} as const
export function recordHref(recordType: RecordType, recordId: string): string {
  return `${RECORD_ROUTES[recordType]}/${recordId}`
}
export type Activity = Tables<"activities">
export const ACTIVITY_LABELS = { note: "Note", call: "Call", email: "Email", meeting: "Meeting", follow_up: "Follow-up" } as const
