import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { safeReturnPath } from "@/lib/supabase/redirect"

import type { Database } from "@/lib/types/database"

/** Public route prefixes that do not require an authenticated session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/api/webhooks", "/api/cron", "/portal"]

function isPublic(pathname: string): boolean {
  if (pathname === "/" || pathname === "/blueprint-preview") return true
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

/**
 * Refreshes the Supabase session cookie on every request and guards app routes.
 * Must be invoked from `proxy.ts` (Next.js 16 proxy convention). Do NOT run
 * logic between `createServerClient` and `auth.getUser()`.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: refreshes tokens; keep this immediately after client creation.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Redirects must carry token refreshes as well as the ordinary response.
  function redirectWithSession(url: URL) {
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirect", pathname)
    return redirectWithSession(url)
  }

  // Preserve local invitation destinations when already signed in.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone()
    const destination = new URL(safeReturnPath(request.nextUrl.searchParams.get("redirect")), request.url)
    url.pathname = destination.pathname
    url.search = destination.search
    url.hash = destination.hash
    return redirectWithSession(url)
  }

  return supabaseResponse
}
