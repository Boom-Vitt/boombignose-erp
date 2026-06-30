import { cache } from "react"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/lib/types/database"

export type Role = Enums<"role_enum">

export type OrgContext = {
  userId: string
  email: string | null
  orgId: string
  orgName: string
  role: Role
}

/**
 * Resolve the signed-in user's organization context (single-org MVP: the user's
 * first membership). Returns null when not signed in or not a member of any org.
 * `cache` dedupes the work within a single request.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership) return null

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.org_id)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: membership.org_id,
    orgName: org?.name ?? "Workspace",
    role: membership.role,
  }
})

/** Like getOrgContext but redirects to /login when there is no context. */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext()
  if (!ctx) redirect("/login")
  return ctx
}

/** Throws when the context's role is not in the allowed set. Defense-in-depth on top of RLS. */
export function requireRole(ctx: OrgContext, allowed: Role[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new Error("Forbidden: your role does not permit this action.")
  }
}
