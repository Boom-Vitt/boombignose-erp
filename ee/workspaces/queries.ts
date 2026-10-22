import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { Role } from "@/lib/auth"

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

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })

  if (membershipError) throw new Error("Unable to load workspace memberships. Please try again.")
  if (!memberships || memberships.length === 0) return []

  const ids = memberships.map((m) => m.org_id)
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", ids)

  if (orgError) throw new Error("Unable to load workspaces. Please try again.")

  const nameById = new Map((orgs ?? []).map((o) => [o.id, o.name] as const))

  return memberships.map((m) => ({
    orgId: m.org_id,
    orgName: nameById.get(m.org_id) ?? "Workspace",
    role: m.role,
  }))
})
