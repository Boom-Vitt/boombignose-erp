import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { todayISO } from "@/lib/dates"
import { isDue, nextRunAfter } from "@/lib/billing/recurring"
import {
  alreadyGeneratedForPeriod,
  buildGeneratedInvoice,
  invoiceNumberFor,
  isUniqueViolation,
} from "@/lib/billing/generate"

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

async function runScan(): Promise<{ generated: number; skipped: number }> {
  const supabase = createAdminClient()
  const today = todayISO()

  // Advance a subscription's schedule after a period is handled (whether we
  // generated an invoice or skipped a duplicate) so the cadence never gets stuck
  // re-scanning the same due row. Returns any update error (null on success).
  const advanceSchedule = async (sub: {
    id: string
    org_id: string
    interval: Parameters<typeof nextRunAfter>[1]
    next_run_date: string
  }): Promise<Error | null> => {
    const { error } = await supabase
      .from("subscriptions")
      .update({
        last_generated_on: today,
        next_run_date: nextRunAfter(sub.next_run_date, sub.interval, today),
      })
      .eq("id", sub.id)
      .eq("org_id", sub.org_id)
    return error ? new Error(error.message) : null
  }

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
  let skipped = 0

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
      // Idempotency: the invoice number is deterministic per period
      // ("Name-YYYYMM") and `invoices` has unique(org_id, number). If this
      // period was already billed, skip creation but still advance the schedule
      // so the cadence moves on instead of re-scanning the same due row.
      const number = invoiceNumberFor(sub.name, today)
      const { data: existing, error: existErr } = await supabase
        .from("invoices")
        .select("number")
        .eq("org_id", sub.org_id)
        .eq("number", number)

      if (existErr) {
        console.error(
          `cron/subscriptions: existence check for ${sub.id} failed`,
          existErr.message
        )
        continue
      }

      if (
        alreadyGeneratedForPeriod(
          (existing ?? []).map((r) => r.number),
          sub.name,
          today
        )
      ) {
        const advErr = await advanceSchedule(sub)
        if (advErr) {
          console.error(
            `cron/subscriptions: advance ${sub.id} (skip) failed`,
            advErr.message
          )
          continue
        }
        skipped += 1
        continue
      }

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
        // Belt-and-suspenders: if two runs raced past the check above, the
        // unique(org_id, number) index rejects the duplicate. Treat that as a
        // benign skip (advance the schedule), not a hard failure.
        if (isUniqueViolation(insErr)) {
          const advErr = await advanceSchedule(sub)
          if (advErr) {
            console.error(
              `cron/subscriptions: advance ${sub.id} (dup) failed`,
              advErr.message
            )
            continue
          }
          skipped += 1
          continue
        }
        console.error(
          `cron/subscriptions: insert invoice for ${sub.id} failed`,
          insErr.message
        )
        continue
      }

      const advErr = await advanceSchedule(sub)
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

  return { generated, skipped }
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
