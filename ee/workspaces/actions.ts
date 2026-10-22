"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { activateWorkspace } from "@/lib/supabase/workspace-session"

// ── Switch active org ───────────────────────────────────────────────────────
const SetActiveOrg = z.object({ orgId: z.string().uuid() })

export async function setActiveOrg(
  input: z.input<typeof SetActiveOrg>
): Promise<{ error?: string }> {
  const parsed = SetActiveOrg.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Only switch to an org the user actually belongs to.
  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("org_id", parsed.data.orgId)
    .maybeSingle()
  if (membershipError) return { error: "Unable to check workspace membership. Please try again." }
  if (!membership) return { error: "You are not a member of that workspace" }

  await activateWorkspace(parsed.data.orgId)

  revalidatePath("/", "layout")
  redirect("/dashboard")
}

const ProvisionWorkspace = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(100, "Use 100 characters or fewer."),
  key: z.string().uuid("Invalid workspace request. Reload this page."),
})

/** Retried requests use the same key; only the database creates org + owner. */
export async function provisionWorkspace(
  input: z.input<typeof ProvisionWorkspace>
): Promise<{ error?: string }> {
  const parsed = ProvisionWorkspace.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid workspace" }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login?redirect=%2Fonboarding")

  const { data: orgId, error } = await supabase.rpc("provision_hosted_workspace", {
    p_name: parsed.data.name,
    p_key: parsed.data.key,
  })
  if (error) return { error: error.message }
  if (!orgId) return { error: "Unable to create your workspace. Please try again." }

  await activateWorkspace(orgId)
  revalidatePath("/", "layout")
  redirect("/dashboard")
}
