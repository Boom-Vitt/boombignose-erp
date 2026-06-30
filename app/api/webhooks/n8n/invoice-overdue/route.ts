import { NextResponse } from "next/server"
import { z } from "zod"

import { verifyWebhookSecret } from "@/lib/webhooks/verify"

// n8n "invoice overdue" webhook.
//
// In production, an n8n scheduled workflow calls this daily. n8n would then
// nudge clients (and the team) about invoices past their `due_date` that are
// still `sent` / `partially_paid` — e.g. send a polite payment reminder and
// flip the invoice status to `overdue`.
//
// Session-less placeholder: authenticate + acknowledge only. No org reads here
// (RLS would block without a session — the real work runs in n8n / a
// service-role job). NOTE: `/api/webhooks/**` is treated as public in
// middleware (lib/supabase/middleware.ts), so no auth redirect fires.

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
    event: "invoice-overdue",
    received: parsed.data,
  })
}

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "invoice-overdue" })
}
