import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { todayISO } from "@/lib/dates"
import { generateSubscriptionOccurrence } from "@/lib/billing/generate"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!verifyWebhookSecret(request.headers.get("X-Cron-Secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const supabase = createAdminClient()
    const { data: subs, error } = await supabase.from("subscriptions")
      .select("id, org_id, next_run_date")
      .eq("status", "active").eq("auto_generate", true).lte("next_run_date", todayISO())
    if (error) throw new Error(error.message)

    let processed = 0
    let failed = 0
    for (const sub of subs ?? []) {
      try {
        // One scheduled date per subscription per scan. Repeat scans catch up
        // missed periods. DB lock and durable occurrence make races retry-safe.
        await generateSubscriptionOccurrence(supabase, sub.org_id, sub.id, sub.next_run_date)
        processed++
      } catch {
        failed++
      }
    }
    return NextResponse.json({ ok: failed === 0, processed, failed }, { status: failed ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: "Subscription scan failed" }, { status: 500 })
  }
}

export async function GET(request: Request) { return POST(request) }
