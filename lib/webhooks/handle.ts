import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWebhookSecret } from "./verify"

const Body = z.object({ orgId: z.uuid(), payload: z.json() }).strict()
const Result = z.object({ eventId: z.uuid(), duplicate: z.boolean() })
export type IntegrationEvent = "followup" | "invoice-overdue" | "project-deadline"

/** Authenticated receipt only: this does not settle invoices or send messages. */
export async function acceptIntegrationWebhook(request: Request, event: IntegrationEvent) {
  if (!verifyWebhookSecret(request.headers.get("X-Webhook-Secret"), process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"))
  if (!key.success) return NextResponse.json({ error: "invalid idempotency key" }, { status: 400 })
  let body: unknown
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).length > 16_384) return NextResponse.json({ error: "payload too large" }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  try {
    const { data, error } = await createAdminClient().rpc("accept_integration_event", {
      p_org_id: parsed.data.orgId, p_event_type: event, p_key: key.data, p_payload: parsed.data.payload,
    })
    if (error) {
      const conflict = error.code === "23505" || error.message.toLowerCase().includes("conflict")
      return NextResponse.json({ error: conflict ? "idempotency conflict" : "event receipt failed" }, { status: conflict ? 409 : 503 })
    }
    const result = Result.safeParse(data)
    if (!result.success) return NextResponse.json({ error: "event receipt failed" }, { status: 503 })
    return NextResponse.json({ ok: true, event, ...result.data })
  } catch {
    return NextResponse.json({ error: "event receipt failed" }, { status: 503 })
  }
}
