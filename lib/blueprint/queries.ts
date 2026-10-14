import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import type { BlueprintOrgSummary } from "./scene-data"

const ACTIVE_PROJECT_STATUSES = new Set([
  "not_started",
  "in_progress",
  "review",
  "support",
])

/**
 * Fetches aggregate counts and status totals for the signed-in user's active
 * organization via RLS. Never reads names, emails, notes, or personal data.
 */
export async function getBlueprintOrgSummary(): Promise<BlueprintOrgSummary> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const orgId = ctx.orgId

  const [
    clientsRes,
    dealsRes,
    quotesRes,
    projectsRes,
    milestonesRes,
    timeEntriesRes,
    invoicesRes,
    claimsRes,
    paymentsRes,
    allocationsRes,
    subscriptionsRes,
    outboundRes,
    aiOutputsRes,
    membershipsRes,
  ] = await Promise.all([
    supabase.from("clients").select("id").eq("org_id", orgId),
    supabase.from("deals").select("stage").eq("org_id", orgId),
    supabase.from("quotes").select("status").eq("org_id", orgId),
    supabase.from("projects").select("status").eq("org_id", orgId),
    supabase.from("milestones").select("done").eq("org_id", orgId),
    supabase.from("time_entries").select("id").eq("org_id", orgId),
    supabase.from("invoices").select("status,issued_snapshot_id").eq("org_id", orgId),
    supabase.from("payment_claims").select("status").eq("org_id", orgId),
    supabase.from("payments").select("verification_state").eq("org_id", orgId),
    supabase.from("payment_allocations").select("id").eq("org_id", orgId),
    supabase.from("subscriptions").select("status").eq("org_id", orgId),
    supabase.from("outbound_events").select("status").eq("org_id", orgId),
    supabase.from("ai_outputs").select("kind").eq("org_id", orgId),
    supabase.from("memberships").select("role").eq("org_id", orgId),
  ])

  const results = [
    clientsRes,
    dealsRes,
    quotesRes,
    projectsRes,
    milestonesRes,
    timeEntriesRes,
    invoicesRes,
    claimsRes,
    paymentsRes,
    allocationsRes,
    subscriptionsRes,
    outboundRes,
    aiOutputsRes,
    membershipsRes,
  ]

  if (results.some((r) => r.error)) {
    throw new Error("Unable to load blueprint summary data.")
  }

  const clients = clientsRes.data ?? []
  const deals = dealsRes.data ?? []
  const quotes = quotesRes.data ?? []
  const projects = projectsRes.data ?? []
  const milestones = milestonesRes.data ?? []
  const timeEntries = timeEntriesRes.data ?? []
  const invoices = invoicesRes.data ?? []
  const claims = claimsRes.data ?? []
  const payments = paymentsRes.data ?? []
  const allocations = allocationsRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []
  const outbound = outboundRes.data ?? []
  const aiOutputs = aiOutputsRes.data ?? []
  const memberships = membershipsRes.data ?? []

  return {
    orgRole: ctx.role,
    clientsTotal: clients.length,
    dealsTotal: deals.length,
    dealsWon: deals.filter((d) => d.stage === "won").length,
    dealsOpen: deals.filter((d) => d.stage !== "won" && d.stage !== "lost").length,
    quotesTotal: quotes.length,
    quotesAcceptedOrConverted: quotes.filter(
      (q) => q.status === "accepted" || q.status === "converted"
    ).length,
    quotesOpen: quotes.filter(
      (q) => q.status === "draft" || q.status === "sent" || q.status === "accepted"
    ).length,
    projectsTotal: projects.length,
    projectsActive: projects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)).length,
    milestonesTotal: milestones.length,
    milestonesDone: milestones.filter((m) => m.done).length,
    timeEntriesTotal: timeEntries.length,
    invoicesTotal: invoices.length,
    invoicesIssued: invoices.filter((i) => i.issued_snapshot_id !== null).length,
    invoicesPaid: invoices.filter((i) => i.status === "paid").length,
    paymentClaimsPending: claims.filter((c) => c.status === "pending").length,
    paymentClaimsVerified: claims.filter((c) => c.status === "verified").length,
    paymentsVerified: payments.filter((p) => p.verification_state === "verified").length,
    paymentAllocationsTotal: allocations.length,
    subscriptionsActive: subscriptions.filter((s) => s.status === "active").length,
    outboundEventsQueued: outbound.filter((o) => o.status === "queued").length,
    outboundEventsDelivered: outbound.filter((o) => o.status === "delivered").length,
    aiOutputsCached: aiOutputs.length,
    membershipsTotal: memberships.length,
  }
}
