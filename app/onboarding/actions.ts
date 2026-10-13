"use server"

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
