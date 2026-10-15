"use client"

import { Suspense, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { normalizeTotpCode, totpErrorMessage } from "@/lib/auth/mfa"
import { createClient } from "@/lib/supabase/client"
import { safeReturnPath } from "@/lib/supabase/redirect"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function MfaChallengeForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirectTo = safeReturnPath(params.get("redirect"))

  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
    const factor = factors?.totp[0]
    if (listError || !factor) {
      setLoading(false)
      toast.error("Verification failed", {
        description: listError?.message ?? "No authenticator is set up. Sign in again.",
      })
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    setLoading(false)
    if (verifyError) {
      setCode("")
      setError(totpErrorMessage(verifyError))
      // The disabled submit button drops focus; put it back for the retry.
      requestAnimationFrame(() => input.current?.focus())
      return
    }
    router.push(redirectTo)
    router.refresh()
  }

  return (
    <AuthShell>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="erp-auth-icon size-5" aria-hidden />
          <CardTitle className="text-xl">Two-factor authentication</CardTitle>
        </div>
        <CardDescription>
          Enter the 6-digit code from your authenticator app.
        </CardDescription>
      </CardHeader>
      <form id="mfa-verify" onSubmit={onSubmit}>
        <CardContent className="space-y-2">
          <Label htmlFor="code">Authentication code</Label>
          <Input
            id="code"
            ref={input}
            className="erp-auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
            aria-invalid={error !== null}
            aria-describedby={error ? "code-error" : undefined}
            required
          />
          {error ? (
            <p id="code-error" role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </CardContent>
      </form>
      <CardFooter className="mt-2 flex-col gap-3">
        <Button type="submit" form="mfa-verify" className="w-full" disabled={loading || code.length !== 6}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
        </Button>
        {/* Signing out is the only way back: the proxy holds this session here until it verifies. */}
        <form action="/auth/signout" method="post" className="text-center text-xs">
          <span className="text-muted-foreground">Not you or lost your device? </span>
          <button type="submit" className="erp-auth-link">
            Sign out
          </button>
        </form>
      </CardFooter>
    </AuthShell>
  )
}

export default function MfaChallengePage() {
  return (
    <Suspense>
      <MfaChallengeForm />
    </Suspense>
  )
}
