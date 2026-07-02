"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { invoiceToExternalPayload } from "@/lib/accounting/mapping"
import { getProvider } from "@/lib/accounting/provider"

/**
 * Scaffold-sync a single invoice to the org's connected accounting provider.
 *
 * SCOPE: maps our invoice to a provider-neutral payload and records the mapping
 * in `accounting_sync_map`. The provider's `pushInvoice` is a STUB (no live HTTP
 * — see lib/accounting/provider.ts). Re-syncing is idempotent: we upsert on the
 * (org, provider, entity, id) key.
 */
export async function syncInvoiceToAccounting(
  invoiceId: string
): Promise<{ externalId?: string; error?: string }> {
  const ctx = await requireOrgContext()

  try {
    requireCapability(ctx, "accounting:manage")
  } catch {
    return { error: "Only an owner or admin can sync to accounting." }
  }

  if (!invoiceId) return { error: "Missing invoice." }

  const supabase = await createClient()

  // The org's accounting connection. A row may exist but be disconnected/error;
  // only a 'connected' one is usable. Belt-and-braces org scope on top of RLS.
  const { data: conn } = await supabase
    .from("accounting_connections")
    .select("provider, status")
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (!conn || conn.status !== "connected") {
    return { error: "Connect an accounting provider first." }
  }

  // Load the invoice (+ client name) — org-scoped in code, not RLS alone.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, number, amount_satang, status, issue_date, due_date, clients(name)")
    .eq("id", invoiceId)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (invErr) return { error: invErr.message }
  if (!invoice) return { error: "Invoice not found." }

  // Map -> neutral payload -> provider (STUB returns a deterministic fake id).
  const payload = invoiceToExternalPayload(invoice, invoice.clients)
  const provider = getProvider(conn.provider)
  const { externalId } = await provider.pushInvoice(payload)

  // Record the mapping. Upsert on the composite unique key so re-sync updates
  // in place (idempotent). Clear any prior error on success.
  const { error: mapErr } = await supabase.from("accounting_sync_map").upsert(
    {
      org_id: ctx.orgId,
      provider: conn.provider,
      local_entity: "invoice",
      local_id: invoice.id,
      external_id: externalId,
      status: "synced",
      last_error: null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider,local_entity,local_id" }
  )
  if (mapErr) return { error: mapErr.message }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: invoice.id,
    action: "updated",
    summary: `Synced invoice ${invoice.number} to ${conn.provider} (${externalId})`,
    meta: { provider: conn.provider, externalId },
  })

  revalidatePath(`/finance/invoices/${invoice.id}`)
  return { externalId }
}
