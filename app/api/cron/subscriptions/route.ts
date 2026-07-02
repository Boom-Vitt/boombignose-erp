import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { todayISO } from "@/lib/dates"
import { isDue, nextRunAfter } from "@/lib/billing/recurring"
import { buildGeneratedInvoice } from "@/lib/billing/generate"

// Cron scan: generates invoices from due recurring subscriptions. A scheduler
// (n8n / Vercel Cron) POSTs this on a timer (e.g. daily 09:00 Asia/Bangkok).
// There is NO user session here, so it authenticates via the `X-Cron-Secret`
// header and uses a service-role client that bypasses RLS — org_id comes from
// each subscription row, never from an auth context.
//
// NOTE: `/api/cron` must be a public prefix at the middleware level (it carries
// no auth cookie). See lib/supabase/middleware.ts `PUBLIC_PREFIXES`.

// Runs on the Node runtime (service-role client uses @supabase/supabase-js).
export const dynamic = "force-dynamic"

async function runScan(): Promise<{ generated: number }> {
  const supabase = createAdminClient()
  const today = todayISO()

  // Candidate rows: active, auto-generating subs scheduled on/before today.
  // `isDue` re-checks each row below; the SQL filter just keeps the scan cheap.
  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select(
      "id, org_id, client_id, project_id, name, amount_satang, interval, status, auto_generate, next_run_date"
    )
    .eq("status", "active")
    .eq("auto_generate", true)
    .lte("next_run_date", today)

  if (error) throw new Error(`scan subscriptions: ${error.message}`)

  let generated = 0

  for (const sub of subs ?? []) {
    if (
      !isDue(
        {
          id: sub.id,
          status: sub.status,
          auto_generate: sub.auto_generate,
          next_run_date: sub.next_run_date,
          interval: sub.interval,
        },
        today
      )
    ) {
      continue
    }

    // Be resilient: a single failing sub must not abort the whole scan.
    try {
      const invoice = buildGeneratedInvoice(
        {
          org_id: sub.org_id,
          client_id: sub.client_id,
          project_id: sub.project_id,
          name: sub.name,
          amount_satang: sub.amount_satang,
          interval: sub.interval,
        },
        today
      )

      const { error: insErr } = await supabase.from("invoices").insert(invoice)
      if (insErr) {
        console.error(
          `cron/subscriptions: insert invoice for ${sub.id} failed`,
          insErr.message
        )
        continue
      }

      const { error: advErr } = await supabase
        .from("subscriptions")
        .update({
          last_generated_on: today,
          next_run_date: nextRunAfter(sub.next_run_date, sub.interval, today),
        })
        .eq("id", sub.id)
        .eq("org_id", sub.org_id)

      if (advErr) {
        console.error(
          `cron/subscriptions: advance ${sub.id} failed`,
          advErr.message
        )
        continue
      }

      generated += 1
    } catch (err) {
      console.error(`cron/subscriptions: unexpected error for ${sub.id}`, err)
    }
  }

  return { generated }
}

export async function POST(request: Request) {
  const secret = request.headers.get("X-Cron-Secret")
  if (!verifyWebhookSecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const result = await runScan()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Allow GET with the same secret so a scheduler health-check can trigger a scan.
export async function GET(request: Request) {
  return POST(request)
}
