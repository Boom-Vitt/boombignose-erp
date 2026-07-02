import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { todayISO } from "@/lib/dates"
import { dueFollowUps, type DealFollowUp, type ActivityFollowUp } from "@/lib/automation/rules"
import { dispatchReminders } from "@/lib/automation/dispatch"

// Cron scan: turns due/overdue CRM follow-ups into `reminders` rows and
// `outbound_events` for n8n / Hermes to consume. A scheduler (n8n / Vercel Cron)
// POSTs this on a timer (e.g. daily 09:00 Asia/Bangkok). There is NO user
// session here, so it authenticates via the `X-Cron-Secret` header and uses a
// service-role client that bypasses RLS — every query is scoped by org_id and
// grouped per org before dispatch.
//
// NOTE: `/api/cron` must be a public prefix at the middleware level (it carries
// no auth cookie). See lib/supabase/middleware.ts `PUBLIC_PREFIXES`.

// Runs on the Node runtime (service-role client uses @supabase/supabase-js).
export const dynamic = "force-dynamic"

type ScanCounts = {
  orgsScanned: number
  remindersUpserted: number
  eventsQueued: number
}

async function runScan(): Promise<ScanCounts> {
  const supabase = createAdminClient()
  const today = todayISO()

  // Pull only candidate rows: open deals with a follow-up on/before today, and
  // not-done activities due on/before today. The rule re-checks these, but
  // filtering in SQL keeps the scan cheap as data grows.
  const [{ data: deals, error: dealsError }, { data: activities, error: actsError }] =
    await Promise.all([
      supabase
        .from("deals")
        .select("id, org_id, title, next_follow_up_date, stage")
        .not("next_follow_up_date", "is", null)
        .lte("next_follow_up_date", today)
        .not("stage", "in", "(won,lost)"),
      supabase
        .from("activities")
        .select("id, org_id, title:body, due_date, done, type")
        .eq("done", false)
        .not("due_date", "is", null)
        .lte("due_date", today),
    ])

  if (dealsError) throw new Error(`scan deals: ${dealsError.message}`)
  if (actsError) throw new Error(`scan activities: ${actsError.message}`)

  // Group candidates by org so each org gets its own dispatch (single-org MVP,
  // but this keeps the boundary correct for multi-org later).
  const dealsByOrg = new Map<string, DealFollowUp[]>()
  for (const d of deals ?? []) {
    const list = dealsByOrg.get(d.org_id) ?? []
    list.push({
      id: d.id,
      title: d.title,
      next_follow_up_date: d.next_follow_up_date,
      stage: d.stage,
    })
    dealsByOrg.set(d.org_id, list)
  }

  const actsByOrg = new Map<string, ActivityFollowUp[]>()
  for (const a of activities ?? []) {
    const list = actsByOrg.get(a.org_id) ?? []
    list.push({
      id: a.id,
      // `body` aliased to `title`; the rule derives a fallback when it's empty.
      title: a.title,
      due_date: a.due_date,
      done: a.done,
      type: a.type,
    })
    actsByOrg.set(a.org_id, list)
  }

  const orgIds = new Set<string>([...dealsByOrg.keys(), ...actsByOrg.keys()])

  let remindersUpserted = 0
  let eventsQueued = 0
  let orgsScanned = 0

  for (const orgId of orgIds) {
    const specs = dueFollowUps(
      dealsByOrg.get(orgId) ?? [],
      actsByOrg.get(orgId) ?? [],
      today
    )
    if (specs.length === 0) continue
    const result = await dispatchReminders(supabase, orgId, specs)
    remindersUpserted += result.remindersUpserted
    eventsQueued += result.eventsQueued
    orgsScanned += 1
  }

  return { orgsScanned, remindersUpserted, eventsQueued }
}

export async function POST(request: Request) {
  const secret = request.headers.get("X-Cron-Secret")
  if (!verifyWebhookSecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const counts = await runScan()
    return NextResponse.json({ ok: true, ...counts })
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Allow GET with the same secret so a scheduler health-check can trigger a scan
// too. Behaves identically to POST.
export async function GET(request: Request) {
  return POST(request)
}
