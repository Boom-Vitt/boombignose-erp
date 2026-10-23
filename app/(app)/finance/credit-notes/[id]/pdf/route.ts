import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { creditNoteDocument } from "@/lib/documents/credit-note"
import { renderDocumentHtml } from "@/lib/documents/printable"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) return new Response("Invalid credit note", { status: 400 })
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data, error } = await supabase.from("credit_notes").select("snapshot").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (error) return new Response("Credit note unavailable", { status: 503 })
  if (!data) return new Response("Credit note not found", { status: 404 })
  try { return new Response(renderDocumentHtml(creditNoteDocument(data.snapshot)), { headers: { "Content-Type": "text/html; charset=utf-8" } }) }
  catch { return new Response("Invalid credit note snapshot", { status: 503 }) }
}
