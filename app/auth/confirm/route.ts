import { type EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { safeRedirectPath } from "@/lib/auth/redirect"

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
  const requestedNext = safeRedirectPath(searchParams.get("next"), "/onboarding")

  const supabase = await createClient()

  // PKCE flow: exchange the auth code for a session.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(requestedNext, request.url), {
        status: 303,
      })
    }
    return failure(request)
  }

  // OTP flow: verify the email token hash.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      const destination = type === "recovery"
        ? safeRedirectPath(searchParams.get("next"), "/reset-password")
        : type === "signup"
          ? "/onboarding"
          : requestedNext
      return NextResponse.redirect(new URL(destination, request.url), {
        status: 303,
      })
    }
    return failure(request)
  }

  return failure(request)
}

/** Redirect to /login without exposing provider-specific auth failures. */
function failure(request: NextRequest) {
  const url = new URL("/login", request.url)
  url.searchParams.set("error", "That link is invalid or expired. Request a new one and try again.")
  return NextResponse.redirect(url, { status: 303 })
}
