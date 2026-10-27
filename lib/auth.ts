import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/lib/types/database"
import { can, type Capability } from "@/lib/permissions"
import { stepUpPath } from "@/lib/auth/totp"

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

/** Authenticated actor, independent of whether workspace onboarding is complete. */
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

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

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })

  if (membershipError) throw new Error("Unable to load workspace memberships. Please try again.")
  if (!memberships || memberships.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value
  const active =
    (preferred && memberships.find((m) => m.org_id === preferred)) ||
    memberships[0]!

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", active.org_id)
    .maybeSingle()

  if (orgError || !org) throw new Error("Unable to load the active workspace. Please try again.")

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: active.org_id,
    orgName: org.name,
    role: active.role,
  }
})

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  )
}

// An enrolled factor must be aal2. A lookup failure does not lock the session:
// an account with no factor, and a machine whose auth server is down, stay usable.
async function redirectIfAAL2Required(): Promise<void> {
  try {
    const supabase = await createClient()
    const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (level.error || !level.data) return
    const next = stepUpPath({
      hasVerifiedTotp: level.data.nextLevel === "aal2",
      authenticatorAssuranceLevel: level.data.currentLevel,
    })
    if (next) redirect(next)
  } catch (err) {
    if (isNextRedirect(err)) throw err
  }
}

/** Login is for signed-out actors; signed-in actors without a workspace onboard. */
export async function requireOrgContext(): Promise<OrgContext> {
  await redirectIfAAL2Required()
  const ctx = await getOrgContext()
  if (!ctx) {
    if (await getAuthenticatedUser()) redirect("/onboarding")
    redirect("/login")
  }
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
