import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { readReplenishmentPlan } from "@/lib/inventory/replenishment"
import { todayISO } from "@/lib/dates"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!verifyWebhookSecret(request.headers.get("X-Cron-Secret"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const dryRun = request.method === "GET" || new URL(request.url).searchParams.get("dry_run") !== "false"
  try {
    const db = createAdminClient()
    const settings = await readAllOrThrow((from, to) => db.from("org_settings").select("org_id").eq("scheduled_replenishment_enabled", true).order("org_id").range(from, to))
    let processed = 0
    let skipped = 0
    let failed = 0
    const preview = []
    for (const setting of settings) {
      let plan
      try { plan = await readReplenishmentPlan(db, setting.org_id, todayISO()) }
      catch { failed++; continue }
      if (dryRun) { preview.push({ orgId: setting.org_id, lines: plan }); continue }
      for (const vendorId of new Set(plan.map(line => line.vendor_id))) {
        const { error: createError } = await db.rpc("create_replenishment_rfq", { p_org_id: setting.org_id, p_vendor_id: vendorId })
        if (createError?.message === "No products require replenishment") skipped++
        else if (createError) failed++
        else processed++
      }
    }
    return NextResponse.json({ ok: failed === 0, dryRun, processed, skipped, failed, ...(dryRun ? { preview } : {}) }, { status: failed ? 503 : 200 })
  } catch { return NextResponse.json({ error: "Replenishment scan failed" }, { status: 500 }) }
}

export async function GET(request: Request) { return POST(request) }
