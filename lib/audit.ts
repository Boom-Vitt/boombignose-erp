import { createClient } from "@/lib/supabase/server"
import type { OrgContext } from "@/lib/auth"
import type { Json } from "@/lib/types/database"

/** One audit entry to append. The `summary` is the human sentence shown in the feed. */
export type AuditEntry = {
  /** What kind of thing changed, e.g. 'deal', 'invoice', 'payment', 'cost', 'settings'. */
  entity: string
  /** The affected row's id, when there is one. */
  entityId?: string | null
  /** What happened, e.g. 'created', 'updated', 'deleted', 'stage_changed', 'payment_recorded'. */
  action: string
  /** Short, human sentence, e.g. `Created deal "Acme website"`. */
  summary: string
  /** Optional structured context (old/new values, amounts, etc.). */
  meta?: Record<string, unknown>
}

/**
 * Append an entry to the org's append-only `audit_log`.
 *
 * BEST-EFFORT BY DESIGN: this must NEVER throw and must never break the real
 * mutation it accompanies. Any failure (auth blip, RLS, network) is swallowed
 * and logged server-side. Call it AFTER a mutation has succeeded and, in actions
 * that redirect, BEFORE the `redirect()` — it does not redirect, so there is no
 * NEXT_REDIRECT to leak. Creates its own session-scoped client (RLS enforced),
 * so the row is always written as the acting user within their org.
 */
export async function writeAudit(ctx: OrgContext, entry: AuditEntry): Promise<void> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from("audit_log").insert({
      org_id: ctx.orgId,
      actor_id: ctx.userId,
      actor_email: ctx.email,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      action: entry.action,
      summary: entry.summary,
      // Column type is Json; Record<string, unknown> is not assignable to it.
      meta: (entry.meta ?? {}) as Json,
    })
    if (error) {
      console.error("writeAudit: insert failed", error.message)
    }
  } catch (err) {
    // Auditing is non-critical; never propagate.
    console.error("writeAudit: unexpected error", err)
  }
}
