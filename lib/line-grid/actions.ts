"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import type { Capability } from "@/lib/permissions"
import { serviceLineAmount } from "@/lib/workflows/service"
import type { DocumentKind, GridRow } from "./grid"
import { gridRows } from "./queries"

const Line = z.object({
  kind: z.literal("line"),
  id: z.guid(),
  product_id: z.guid().nullable(),
  description: z.string().trim().min(1).max(4000),
  quantity: z.string().trim(),
  unit: z.string().trim().min(1).max(40),
  unit_price_satang: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  tax_rate_bps: z.number().int().min(0).max(10000),
}).refine(line => { try { serviceLineAmount(line.quantity, line.unit_price_satang); return true } catch { return false } })
const Text = z.object({ kind: z.enum(["section", "note"]), id: z.guid(), description: z.string().trim().min(1).max(4000) })
const SaveLines = z.object({
  document: z.enum(["quote", "invoice", "purchase_order"]),
  documentId: z.guid(),
  rows: z.array(z.discriminatedUnion("kind", [Line, Text])).max(500),
  deleted: z.array(z.guid()).max(500),
})

const DOCUMENTS: Record<DocumentKind, { capability: Capability; path: string }> = {
  quote: { capability: "record:write", path: "/quotes" },
  invoice: { capability: "payment:verify", path: "/finance/invoices" },
  purchase_order: { capability: "purchase:manage", path: "/purchases" },
}

/** One atomic save of every line change; the rows the server then holds replace the client draft. */
export async function saveDocumentLines(input: z.input<typeof SaveLines>): Promise<{ rows?: GridRow[]; error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = SaveLines.safeParse(input)
  if (!parsed.success) return { error: "Some lines are invalid. Fix the highlighted cells and save again." }
  const { document, documentId, rows, deleted } = parsed.data
  try { requireCapability(ctx, DOCUMENTS[document].capability) }
  catch { return { error: "You cannot edit these lines." } }
  const db = await createClient()
  const { error } = await db.rpc("save_document_lines", { p_document: document, p_document_id: documentId, p_rows: rows, p_deleted: deleted })
  if (error) return { error: error.message }
  const lines = rows.filter(row => row.kind === "line").length
  await writeAudit(ctx, {
    entity: document, entityId: documentId, action: "lines_saved",
    summary: `Saved ${lines} line${lines === 1 ? "" : "s"} and ${rows.length - lines} section or note row${rows.length - lines === 1 ? "" : "s"}${deleted.length ? `; removed ${deleted.length}` : ""}`,
    meta: { lines, sections: rows.length - lines, removed: deleted.length },
  })
  revalidatePath(`${DOCUMENTS[document].path}/${documentId}`)
  try { return { rows: await gridRows(db, ctx.orgId, document, documentId) } }
  catch { return { error: "Lines saved, but reloading them failed. Reload the page." } }
}
