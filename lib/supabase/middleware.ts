import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { MFA_PATH, mfaPath, needsMfa } from "@/lib/auth/mfa"
import { safeReturnPath } from "@/lib/supabase/redirect"

import type { Database } from "@/lib/types/database"

/** Public route prefixes that do not require an authenticated session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot-password", "/auth", "/api/webhooks", "/api/cron", "/portal"]

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
  // Factors come from the verified user above; the cookie session only supplies its own aal claim.
  const mfaPending = user
    ? needsMfa(user.factors, (await supabase.auth.getSession()).data.session?.access_token)
    : false

  // Redirects must carry token refreshes as well as the ordinary response.
  function redirectWithSession(url: URL) {
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  if (!user && (!isPublic(pathname) || pathname === MFA_PATH)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    // The challenge page already carries the original destination.
    if (pathname !== MFA_PATH) url.searchParams.set("redirect", pathname)
    return redirectWithSession(url)
  }

  // A password-only session must pass its TOTP challenge before reaching the app.
  if (mfaPending && !isPublic(pathname)) {
    return redirectWithSession(new URL(mfaPath(pathname), request.url))
  }

  // Preserve local invitation destinations when already signed in.
  const authPage = pathname === "/login" || pathname === "/signup" || pathname === MFA_PATH
  if (user && authPage && !(mfaPending && pathname === MFA_PATH)) {
    const destination = safeReturnPath(request.nextUrl.searchParams.get("redirect"))
    return redirectWithSession(new URL(mfaPending ? mfaPath(destination) : destination, request.url))
  }

  return supabaseResponse
}
