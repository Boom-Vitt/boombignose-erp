"use client"

import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { sessionNeedsStepUp } from "@/lib/auth/totp"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Enrolled = {
  factorId: string
  secret: string
  qr: string
}

export function EnrollTotp() {
  const [loading, setLoading] = useState(false)
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null)
  const [code, setCode] = useState("")
  const [verified, setVerified] = useState(false)
  const [needsStepUp, setNeedsStepUp] = useState(false)

  async function refreshLevel() {
    const supabase = createClient()
    const [level, factors] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ])
    if (level.error) {
      toast.error("Could not read the authenticator level", { description: level.error.message })
      return
    }
    if (factors.error) {
      toast.error("Could not list authenticators", { description: factors.error.message })
      return
    }
    const verifiedFactor = (factors.data?.totp ?? []).some((factor) => factor.status === "verified")
    setVerified(verifiedFactor)
    setNeedsStepUp(
      sessionNeedsStepUp({
        enrollEnabled: true,
        hasVerifiedTotp: verifiedFactor,
        authenticatorAssuranceLevel: level.data?.currentLevel,
      })
    )
  }

  async function start() {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "BoomBigNose",
    })
    setLoading(false)
    if (error || !data?.id || !data.totp?.secret) {
      toast.error("Enrollment did not start", {
        description: error?.message ?? "The local auth server returned no factor.",
      })
      return
    }
    setEnrolled({
      factorId: data.id,
      secret: data.totp.secret,
      qr: data.totp.qr_code,
    })
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!enrolled) return
    setLoading(true)
    const supabase = createClient()
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrolled.factorId })
    if (challenge.error || !challenge.data?.id) {
      setLoading(false)
      toast.error("Could not start verification", { description: challenge.error?.message })
      return
    }
    const checked = await supabase.auth.mfa.verify({
      factorId: enrolled.factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    })
    setLoading(false)
    if (checked.error) {
      toast.error("Code was not accepted", { description: checked.error.message })
      return
    }
    setEnrolled(null)
    setCode("")
    toast.success("Authenticator saved")
    await refreshLevel()
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" onClick={() => void refreshLevel()} disabled={loading}>
        Check this session
      </Button>
      {verified ? <p>An authenticator is already saved for this account.</p> : null}
      {needsStepUp ? (
        <p role="status">
          This session is still aal1. The next sign-in can ask for the authenticator
          code. Other pages are not blocked.
        </p>
      ) : null}
      {enrolled ? (
        <form onSubmit={(event) => void confirm(event)} className="space-y-3">
          {enrolled.qr.startsWith("data:image/") ? (
            // The QR is a data URL returned by the local auth server. next/image does not apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={enrolled.qr} alt="Authenticator QR code" width={180} height={180} />
          ) : null}
          <p>
            Secret <code>{enrolled.secret}</code>
          </p>
          <div className="space-y-2">
            <Label htmlFor="totp-code">Code</Label>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Verify code"}
          </Button>
        </form>
      ) : (
        <Button type="button" onClick={() => void start()} disabled={loading || verified}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Set up authenticator"}
        </Button>
      )}
    </div>
  )
}
