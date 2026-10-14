import { createBrowserClient } from "@supabase/ssr"

import { readPublicEnv } from "@/lib/supabase/public-env"
import type { Database } from "@/lib/types/database"

/**
 * Supabase client for Client Components (browser). Uses the public anon key and
 * is subject to RLS. Safe to call in "use client" components.
 */
export function createClient() {
  const { url, anonKey } = readPublicEnv()
  return createBrowserClient<Database>(url, anonKey)
}
