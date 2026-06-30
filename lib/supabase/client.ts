import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@/lib/types/database"

/**
 * Supabase client for Client Components (browser). Uses the public anon key and
 * is subject to RLS. Safe to call in "use client" components.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
