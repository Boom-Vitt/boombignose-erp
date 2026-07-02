import { type EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * Email-confirmation callback for signups (and other email OTP links).
 *
 * Supabase appends one of two shapes to the redirect URL depending on the
 * email template / flow:
 *   - `?token_hash=...&type=signup`  → verify with `verifyOtp`
 *   - `?code=...` (PKCE)             → exchange with `exchangeCodeForSession`
 * We handle both so the local Inbucket default template and a PKCE template
 * both work without editing the template.
 *
 * IMPORTANT: uses the SSR server client so the verified session is written to
 * the response cookies; a plain `@supabase/supabase-js` client would verify but
 * leave the user unauthenticated. On success → /dashboard, else → /login.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const code = searchParams.get("code")

  const supabase = await createClient()

  // PKCE flow: exchange the auth code for a session.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL("/dashboard", request.url), {
        status: 303,
      })
    }
    return failure(request, error.message)
  }

  // OTP flow: verify the email token hash.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      return NextResponse.redirect(new URL("/dashboard", request.url), {
        status: 303,
      })
    }
    return failure(request, error.message)
  }

  return failure(request, "Invalid or expired confirmation link.")
}

/** Redirect to /login with a human-readable error message in the query. */
function failure(request: NextRequest, message: string) {
  const url = new URL("/login", request.url)
  url.searchParams.set("error", message)
  return NextResponse.redirect(url, { status: 303 })
}
