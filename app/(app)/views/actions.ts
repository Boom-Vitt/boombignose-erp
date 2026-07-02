"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"

/** Modules that can have saved views, mapped to the path we revalidate. */
const MODULE_PATH: Record<string, string> = {
  deals: "/deals",
  finance: "/finance",
  clients: "/clients",
}

const MODULES = ["deals", "finance", "clients"] as const

/**
 * Filter config persisted with a saved view. Kept to the known, URL-driven
 * filter keys per module so loading a view only ever produces a safe query
 * string — never arbitrary JSON dumped into the URL.
 */
const ViewConfig = z
  .object({
    stage: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
  })
  .strict()
export type ViewConfig = z.infer<typeof ViewConfig>

const CreateSavedViewInput = z.object({
  module: z.enum(MODULES),
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  config: ViewConfig.default({}),
})
export type CreateSavedViewInput = z.infer<typeof CreateSavedViewInput>

export async function createSavedView(
  input: CreateSavedViewInput
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateSavedViewInput.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const v = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from("saved_views").insert({
    org_id: ctx.orgId,
    user_id: ctx.userId,
    module: v.module,
    name: v.name,
    config: v.config,
  })

  if (error) return { error: error.message }

  revalidatePath(MODULE_PATH[v.module])
  return {}
}

const DeleteSavedViewInput = z.object({ id: z.string().uuid() })

export async function deleteSavedView(
  id: string
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DeleteSavedViewInput.safeParse({ id })
  if (!parsed.success) return { error: "Invalid view" }

  const supabase = await createSupabaseClient()
  // Read the module first so we know which page to revalidate after deletion.
  // Scope to the owning user so one member can't delete another's saved view
  // (saved_views RLS is org-wide; per-user ownership is enforced here).
  const { data: existing } = await supabase
    .from("saved_views")
    .select("module")
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .maybeSingle()

  const { error } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)

  if (error) return { error: error.message }

  const path = existing?.module ? MODULE_PATH[existing.module] : null
  if (path) revalidatePath(path)
  return {}
}
