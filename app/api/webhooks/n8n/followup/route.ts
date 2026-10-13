import { NextResponse } from "next/server"
import { acceptIntegrationWebhook } from "@/lib/webhooks/handle"

export async function POST(request: Request) {
  return acceptIntegrationWebhook(request, "followup")
}

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "followup" })
}
