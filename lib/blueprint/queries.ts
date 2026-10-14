import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import type { Enums } from "@/lib/types/database"
import type { BlueprintOrgSummary } from "./scene-data"

const ACTIVE_PROJECT_STATUSES: Enums<"project_status">[] = [
  "not_started",
  "in_progress",
  "review",
  "support",
]

const OPEN_QUOTE_STATUSES: Enums<"quote_status">[] = [
  "draft",
  "sent",
  "accepted",
]

const ACCEPTED_OR_CONVERTED_QUOTE_STATUSES: Enums<"quote_status">[] = [
  "accepted",
  "converted",
]

/**
 * Fetches exact head counts and status totals for the signed-in user's active
 * organization via RLS (`{ count: "exact", head: true }`), avoiding PostgREST
 * row-fetch caps (`max_rows = 1000`). Never reads names, emails, notes, or personal data.
 */
export async function getBlueprintOrgSummary(): Promise<BlueprintOrgSummary> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const orgId = ctx.orgId
  const isStaff = ctx.role === "owner" || ctx.role === "admin"

  const [
    clientsTotalRes,
    dealsTotalRes,
    dealsWonRes,
    dealsOpenRes,
    quotesTotalRes,
    quotesAcceptedOrConvertedRes,
    quotesOpenRes,
    projectsTotalRes,
    projectsActiveRes,
    milestonesTotalRes,
    milestonesDoneRes,
    timeEntriesTotalRes,
    invoicesTotalRes,
    invoicesIssuedRes,
    paymentClaimsPendingRes,
    paymentClaimsVerifiedRes,
    paymentsVerifiedRes,
    paymentAllocationsTotalRes,
    subscriptionsActiveRes,
    outboundEventsQueuedRes,
    outboundEventsDeliveredRes,
    aiOutputsCachedRes,
  ] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("deals").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("deals").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("stage", "won"),
    supabase.from("deals").select("id", { count: "exact", head: true }).eq("org_id", orgId).not("stage", "in", "(won,lost)"),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ACCEPTED_OR_CONVERTED_QUOTE_STATUSES),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", OPEN_QUOTE_STATUSES),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ACTIVE_PROJECT_STATUSES),
    supabase.from("milestones").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("milestones").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("done", true),
    supabase.from("time_entries").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", orgId).not("issued_snapshot_id", "is", null),
    supabase.from("payment_claims").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    supabase.from("payment_claims").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "verified"),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("verification_state", "verified"),
    supabase.from("payment_allocations").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
    isStaff
      ? supabase.from("outbound_events").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "queued")
      : Promise.resolve({ count: null, error: null }),
    isStaff
      ? supabase.from("outbound_events").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "delivered")
      : Promise.resolve({ count: null, error: null }),
    supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ])

  const results = [
    clientsTotalRes,
    dealsTotalRes,
    dealsWonRes,
    dealsOpenRes,
    quotesTotalRes,
    quotesAcceptedOrConvertedRes,
    quotesOpenRes,
    projectsTotalRes,
    projectsActiveRes,
    milestonesTotalRes,
    milestonesDoneRes,
    timeEntriesTotalRes,
    invoicesTotalRes,
    invoicesIssuedRes,
    paymentClaimsPendingRes,
    paymentClaimsVerifiedRes,
    paymentsVerifiedRes,
    paymentAllocationsTotalRes,
    subscriptionsActiveRes,
    outboundEventsQueuedRes,
    outboundEventsDeliveredRes,
    aiOutputsCachedRes,
  ]

  if (results.some((r) => r.error)) {
    throw new Error("Unable to load blueprint summary data.")
  }

  return {
    orgRole: ctx.role,
    clientsTotal: clientsTotalRes.count ?? 0,
    dealsTotal: dealsTotalRes.count ?? 0,
    dealsWon: dealsWonRes.count ?? 0,
    dealsOpen: dealsOpenRes.count ?? 0,
    quotesTotal: quotesTotalRes.count ?? 0,
    quotesAcceptedOrConverted: quotesAcceptedOrConvertedRes.count ?? 0,
    quotesOpen: quotesOpenRes.count ?? 0,
    projectsTotal: projectsTotalRes.count ?? 0,
    projectsActive: projectsActiveRes.count ?? 0,
    milestonesTotal: milestonesTotalRes.count ?? 0,
    milestonesDone: milestonesDoneRes.count ?? 0,
    timeEntriesTotal: timeEntriesTotalRes.count ?? 0,
    invoicesTotal: invoicesTotalRes.count ?? 0,
    invoicesIssued: invoicesIssuedRes.count ?? 0,
    paymentClaimsPending: paymentClaimsPendingRes.count ?? 0,
    paymentClaimsVerified: paymentClaimsVerifiedRes.count ?? 0,
    paymentsVerified: paymentsVerifiedRes.count ?? 0,
    paymentAllocationsTotal: paymentAllocationsTotalRes.count ?? 0,
    subscriptionsActive: subscriptionsActiveRes.count ?? 0,
    outboundEventsQueued: isStaff ? (outboundEventsQueuedRes.count ?? 0) : null,
    outboundEventsDelivered: isStaff ? (outboundEventsDeliveredRes.count ?? 0) : null,
    aiOutputsCached: aiOutputsCachedRes.count ?? 0,
  }
}
