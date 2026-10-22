"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { activateWorkspace } from "@/lib/supabase/workspace-session"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { safeReturnPath } from "@/lib/supabase/redirect"

/** Zero-workspace users can change accounts without requiring app navigation. */
export async function signOutTo(returnTo: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error("Unable to sign out. Please try again.")
  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_ORG_COOKIE)
  redirect(`/login?redirect=${encodeURIComponent(safeReturnPath(returnTo))}`)
}

const CreateWorkspace = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(100, "Use 100 characters or fewer."),
  key: z.string().uuid("Invalid workspace request. Reload this page."),
})

/** Retried requests use the same key; only the database creates org + owner. */
export async function createFirstWorkspace(
  input: z.input<typeof CreateWorkspace>
): Promise<{ error?: string }> {
  const parsed = CreateWorkspace.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid workspace" }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login?redirect=%2Fonboarding")

  const { data: orgId, error } = await supabase.rpc("provision_workspace", {
    p_name: parsed.data.name,
    p_key: parsed.data.key,
  })
  if (error) return { error: error.message }
  if (!orgId) return { error: "Unable to create your workspace. Please try again." }

  await activateWorkspace(orgId)
  revalidatePath("/", "layout")
  redirect("/dashboard")
}
