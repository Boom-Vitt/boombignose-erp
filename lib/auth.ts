import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/lib/types/database"
import { can, type Capability } from "@/lib/permissions"

export type Role = Enums<"role_enum">

/** Cookie holding the user's currently-active org id (multi-org switcher). */
export const ACTIVE_ORG_COOKIE = "active_org"

export type OrgContext = {
  userId: string
  email: string | null
  orgId: string
  orgName: string
  role: Role
}

/**
 * Resolve the signed-in user's active organization context. The active org is
 * the one named by the `active_org` cookie when the user is a member of it,
 * otherwise their first membership (stable single-org default). Returns null
 * when not signed in or not a member of any org. `cache` dedupes within a
 * single request.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: memberships } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })

  if (!memberships || memberships.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value
  const active =
    (preferred && memberships.find((m) => m.org_id === preferred)) ||
    memberships[0]!

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", active.org_id)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: active.org_id,
    orgName: org?.name ?? "Workspace",
    role: active.role,
  }
})

export type UserOrg = { orgId: string; orgName: string; role: Role }

/**
 * All orgs the signed-in user belongs to, for the org switcher. Ordered by join
 * date (matching the default-active choice in getOrgContext).
 */
export const getUserOrgs = cache(async (): Promise<UserOrg[]> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: memberships } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })

  if (!memberships || memberships.length === 0) return []

  const ids = memberships.map((m) => m.org_id)
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", ids)

  const nameById = new Map((orgs ?? []).map((o) => [o.id, o.name] as const))

  return memberships.map((m) => ({
    orgId: m.org_id,
    orgName: nameById.get(m.org_id) ?? "Workspace",
    role: m.role,
  }))
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

/**
 * Capability-based gate (preferred over requireRole). Throws when the context's
 * role does not hold `capability` per the matrix in lib/permissions. Kept here
 * so every action can import a single auth surface.
 */
export function requireCapability(ctx: OrgContext, capability: Capability): void {
  if (!can(ctx.role, capability)) {
    throw new Error("Forbidden: your role does not permit this action.")
  }
}
