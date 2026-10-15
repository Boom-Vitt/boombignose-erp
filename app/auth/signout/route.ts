import { NextResponse } from "next/server"

import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 })
  // The next account on this browser should not inherit the previous workspace choice.
  response.cookies.delete(ACTIVE_ORG_COOKIE)
  return response
}
