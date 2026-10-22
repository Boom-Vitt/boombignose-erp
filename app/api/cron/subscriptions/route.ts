import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { todayISO } from "@/lib/dates"
import { generateSubscriptionOccurrence } from "@/lib/billing/generate"
import { readAll } from "@/lib/supabase/read-all"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!verifyWebhookSecret(request.headers.get("X-Cron-Secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const supabase = createAdminClient()
    const today = todayISO()
    const { data: subs, error } = await readAll((from, to) => supabase.from("subscriptions")
      .select("id, org_id, next_run_date")
      .eq("status", "active").eq("auto_generate", true).lte("next_run_date", today)
      .order("id").range(from, to))
    if (error || !subs) throw new Error(error?.message ?? "Subscription scan unavailable")

    let processed = 0
    let failed = 0
    for (const sub of subs ?? []) {
      try {
        // One scheduled date per subscription per scan. Repeat scans catch up
        // missed periods. DB lock and durable occurrence make races retry-safe.
        await generateSubscriptionOccurrence(supabase, sub.org_id, sub.id, sub.next_run_date)
        processed++
      } catch (error) {
        failed++
        const reason = error instanceof Error ? error.message : "Invoice generation failed"
        const context = { subscriptionId: sub.id, orgId: sub.org_id, occurrence: sub.next_run_date, reason }
        console.error("subscription_generation_failed", context)
        try {
          const { error: auditError } = await supabase.from("audit_log").insert({
            org_id: sub.org_id,
            entity: "subscription",
            entity_id: sub.id,
            action: "generation_failed",
            summary: `Scheduled invoice failed: ${reason}`,
            meta: { occurrence: sub.next_run_date, reason },
          })
          if (auditError) console.error("subscription_failure_audit_failed", { ...context, auditReason: auditError.message })
        } catch (auditError) {
          console.error("subscription_failure_audit_failed", { ...context, auditReason: auditError instanceof Error ? auditError.message : "Audit unavailable" })
        }
      }
    }
    return NextResponse.json({ ok: failed === 0, processed, failed }, { status: failed ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: "Subscription scan failed" }, { status: 500 })
  }
}

export async function GET(request: Request) { return POST(request) }
