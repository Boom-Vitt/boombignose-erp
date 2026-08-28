"use server"

import { cookies } from "next/headers"
import { z } from "zod"

import { safeRedirectPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/server"

const WorkspaceSchema = z.string().trim().min(2, "Workspace name must be at least 2 characters.").max(80, "Workspace name must be 80 characters or fewer.")

export async function createWorkspace(input: { name: string; next?: string }): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const parsed = WorkspaceSchema.safeParse(input.name)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid workspace name." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_workspace_for_current_user", { workspace_name: parsed.data })
  if (error || !data) return { ok: false, error: "We couldn't create your workspace. Please try again." }

  const cookieStore = await cookies()
  cookieStore.set("active_org", data, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" })
  return { ok: true, redirectTo: safeRedirectPath(input.next) }
}
