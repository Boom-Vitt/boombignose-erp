import { NextResponse } from "next/server"
import { z } from "zod"

import { verifyWebhookSecret } from "@/lib/webhooks/verify"

// n8n "follow-up reminder" webhook.
//
// In production, an n8n scheduled workflow calls this each morning. n8n would
// then fan out reminders (Slack/email) for CRM follow-ups whose
// `next_follow_up_date` (deals) or `due_date` (activities) is today.
//
// This is a session-less placeholder: it only authenticates the caller and
// acknowledges the payload. It does NOT read org data — without a user session
// RLS would block every query, so the actual fan-out lives inside n8n / a
// service-role job. NOTE: `/api/webhooks/**` is already whitelisted as a public
// prefix in middleware (lib/supabase/middleware.ts), so no auth redirect fires.

const Payload = z.object({}).passthrough()

export async function POST(request: Request) {
  const secret = request.headers.get("X-Webhook-Secret")
  if (!verifyWebhookSecret(secret, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = Payload.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    event: "followup",
    received: parsed.data,
  })
}

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "followup" })
}
