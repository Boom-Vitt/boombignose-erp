"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { TwoFactorSettings } from "@/app/(app)/settings/_components/two-factor-settings"
import { safeReturnPath } from "@/lib/supabase/redirect"
import { AuthShell } from "@/components/auth-shell"
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

/** Post-signup step: enroll a TOTP authenticator (Google Authenticator etc.) via QR. */
function SetupTwoFactor() {
  const router = useRouter()
  const returnTo = useSearchParams().get("redirect")
  const next = returnTo ? safeReturnPath(returnTo) : "/onboarding"
  const done = () => {
    router.push(next)
    router.refresh()
  }
  return (
    <AuthShell>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="erp-auth-icon size-5" aria-hidden />
          <CardTitle className="text-xl">Protect your account</CardTitle>
        </div>
        <CardDescription>
          Scan a QR code with Google Authenticator (or any authenticator app). Every sign-in will
          then need your password plus the 6-digit code from the app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorSettings factorId={null} onEnabled={done} />
      </CardContent>
      <CardFooter className="mt-2 justify-center text-xs">
        <Link href={next} className="erp-auth-link">
          Skip for now (set up later in Settings)
        </Link>
      </CardFooter>
    </AuthShell>
  )
}

export default function SetupTwoFactorPage() {
  return (
    <Suspense>
      <SetupTwoFactor />
    </Suspense>
  )
}
