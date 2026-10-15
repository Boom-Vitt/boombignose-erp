import { NextResponse, type NextRequest } from "next/server"

import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 })
  // The next account on this browser should not inherit the previous workspace choice.
  response.cookies.delete(ACTIVE_ORG_COOKIE)
  // When the logout request fails (auth server unreachable) supabase-js keeps its session cookies;
  // this browser must still end up signed out.
  if (error) {
    for (const { name } of request.cookies.getAll()) if (name.startsWith("sb-")) response.cookies.delete(name)
  }
  return response
}
