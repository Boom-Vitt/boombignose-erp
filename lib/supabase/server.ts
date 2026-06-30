import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import type { Database } from "@/lib/types/database"

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Bound to the user's session via cookies and subject to RLS. Create a new one
 * per request — never share across requests.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // `setAll` was called from a Server Component, which cannot write
            // cookies. Safe to ignore — the middleware refreshes the session.
          }
        },
      },
    }
  )
}
