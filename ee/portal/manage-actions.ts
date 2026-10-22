"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"

/**
 * AUTHENTICATED, org-side management of a client's public portal. These run with
 * the session-scoped (RLS-enforced) client and are gated to owners/admins via
 * `settings:manage`. Every mutation is org-scoped. The generated token is a
 * high-entropy opaque string (two UUIDs, hex only) that becomes the portal's
 * sole credential — treat it as a secret and never log it.
 */

/** Opaque, unguessable portal token: two UUIDs, hyphens stripped (64 hex chars). */
function generatePortalToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
  )
}

const ClientId = z.object({ clientId: z.string().min(1) })

export async function enableClientPortal(
  clientId: string
): Promise<{ error?: string; token?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "settings:manage")
  } catch {
    return { error: "Only owners and admins can manage the client portal." }
  }
  const parsed = ClientId.safeParse({ clientId })
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()

  // Reuse an existing token if one was previously issued so the shared link
  // survives a disable → enable cycle; only mint one when none exists.
  const { data: existing, error: readErr } = await supabase
    .from("clients")
    .select("portal_token")
    .eq("id", parsed.data.clientId)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (readErr || !existing) return { error: "Client not found." }

  const token = existing.portal_token ?? generatePortalToken()

  const { error } = await supabase
    .from("clients")
    .update({ portal_enabled: true, portal_token: token })
    .eq("id", parsed.data.clientId)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "client",
    entityId: parsed.data.clientId,
    action: "portal_enabled",
    summary: "Enabled the client portal",
  })

  revalidatePath(`/clients/${parsed.data.clientId}`)
  return { token }
}

export async function disableClientPortal(
  clientId: string
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "settings:manage")
  } catch {
    return { error: "Only owners and admins can manage the client portal." }
  }
  const parsed = ClientId.safeParse({ clientId })
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()

  // Keep the token so re-enabling restores the same link; just flip the flag,
  // which is what the public portal checks (portal_enabled = true).
  const { error } = await supabase
    .from("clients")
    .update({ portal_enabled: false })
    .eq("id", parsed.data.clientId)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "client",
    entityId: parsed.data.clientId,
    action: "portal_disabled",
    summary: "Disabled the client portal",
  })

  revalidatePath(`/clients/${parsed.data.clientId}`)
  return {}
}

export async function regeneratePortalToken(
  clientId: string
): Promise<{ error?: string; token?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "settings:manage")
  } catch {
    return { error: "Only owners and admins can manage the client portal." }
  }
  const parsed = ClientId.safeParse({ clientId })
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const token = generatePortalToken()

  const { error } = await supabase
    .from("clients")
    .update({ portal_token: token, portal_enabled: true })
    .eq("id", parsed.data.clientId)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "client",
    entityId: parsed.data.clientId,
    action: "portal_token_regenerated",
    summary: "Regenerated the client portal link",
  })

  revalidatePath(`/clients/${parsed.data.clientId}`)
  return { token }
}
