import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "@/lib/webhooks/verify"
import { deliverOutbox } from "@/lib/automation/outbox"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!verifyWebhookSecret(request.headers.get("X-Cron-Secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const url = process.env.N8N_OUTBOUND_URL
  const secret = process.env.N8N_OUTBOUND_SECRET
  if (!url || !secret) return NextResponse.json({ ok: true, disabled: true })
  try {
    const result = await deliverOutbox(createAdminClient(), { url, secret })
    const ok = result.failed === 0 && result.unacknowledged === 0
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503 })
  } catch {
    return NextResponse.json({ error: "Outbox delivery failed" }, { status: 503 })
  }
}
