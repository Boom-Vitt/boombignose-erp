import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"

import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { authCookieNames, loopbackRedirect, supabaseStorageKey } from "@/lib/supabase/auth-cookies"
import type { Database } from "@/lib/types/database"

const expired = { path: "/", maxAge: 0, sameSite: "lax" as const }

function cookiePairs(header: string) {
  return header.split(";").flatMap((part) => {
    const trimmed = part.trim()
    if (!trimmed) return []
    const eq = trimmed.indexOf("=")
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq).trim()
    if (!name) return []
    return [{ name, value: eq === -1 ? "" : trimmed.slice(eq + 1) }]
  })
}

export async function POST(request: Request) {
  const response = NextResponse.redirect(
    loopbackRedirect("/login", request, process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3100"),
    { status: 303 },
  )
  const header = request.headers.get("cookie") ?? ""
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookiePairs(header)
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )
  await supabase.auth.signOut()
  // setAll only expires names it loaded. Expire every chunk from the request
  // as well, so a later sign-in is not combined with a leftover piece.
  for (const name of authCookieNames(header, supabaseStorageKey(process.env.NEXT_PUBLIC_SUPABASE_URL!))) {
    response.cookies.set(name, "", expired)
  }
  response.cookies.set(ACTIVE_ORG_COOKIE, "", expired)
  return response
}
