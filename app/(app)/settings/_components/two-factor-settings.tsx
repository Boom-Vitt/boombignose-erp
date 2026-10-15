"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { normalizeTotpCode, totpErrorMessage } from "@/lib/auth/mfa"
import { isDeadSessionError } from "@/lib/auth/password"
import { createClient } from "@/lib/supabase/client"
import { withReturnPath } from "@/lib/supabase/redirect"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Enrollment = { factorId: string; qrCode: string; secret: string }

/** TOTP on/off for the signed-in user. `factorId` is their verified factor, if any. */
export function TwoFactorSettings({
  factorId,
  onEnabled,
}: {
  factorId: string | null
  /** Called after a factor is verified; defaults to refreshing the page. */
  onEnabled?: () => void
}) {
  const router = useRouter()
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)

  // Signed out elsewhere or idle too long: only a fresh sign-in helps, so come back here after it.
  function signInAgain() {
    router.push(withReturnPath("/login", window.location.pathname + window.location.search))
  }

  async function startSetup() {
    setBusy(true)
    const { mfa } = createClient().auth
    // An abandoned setup leaves an unverified factor behind; clear it so enroll succeeds.
    const { data: factors } = await mfa.listFactors()
    for (const stale of factors?.all.filter((f) => f.status === "unverified") ?? []) {
      await mfa.unenroll({ factorId: stale.id })
    }
    const { data, error } = await mfa.enroll({ factorType: "totp", issuer: "BoomBigNose" })
    setBusy(false)
    if (error && isDeadSessionError(error)) return signInAgain()
    if (error) {
      toast.error("Could not start setup", { description: error.message })
      return
    }
    setCodeError(null)
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollment) return
    setBusy(true)
    setCodeError(null)
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    })
    setBusy(false)
    if (error && isDeadSessionError(error)) return signInAgain()
    if (error) {
      setCode("")
      setCodeError(totpErrorMessage(error))
      // The disabled submit button drops focus; put it back for the retry.
      requestAnimationFrame(() => codeInput.current?.focus())
      return
    }
    toast.success("Two-factor authentication is on")
    setEnrollment(null)
    setCode("")
    if (onEnabled) onEnabled()
    else router.refresh()
  }

  async function turnOff() {
    if (!factorId) return
    setBusy(true)
    const { error } = await createClient().auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error && isDeadSessionError(error)) return signInAgain()
    if (error) {
      toast.error("Could not turn off two-factor authentication", { description: error.message })
      return
    }
    toast.success("Two-factor authentication is off")
    router.refresh()
  }

  if (factorId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="erp-auth-icon size-4" aria-hidden />
          Authenticator app
          <Badge variant="secondary">On</Badge>
        </div>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>
            Turn off
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn off two-factor authentication?</AlertDialogTitle>
              <AlertDialogDescription>
                Sign-in will only need your password. You can set it up again at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void turnOff()}>
                Turn off
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  if (enrollment) {
    return (
      <form onSubmit={verify} className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy),
          then enter the 6-digit code it shows.
        </p>
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns an SVG data URL */}
          <img src={enrollment.qrCode} alt="QR code to add BoomBigNose to your authenticator app" className="erp-auth-qr" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-muted-foreground text-xs">Can&apos;t scan? Enter this key instead:</p>
            <code className="block break-all rounded-md border bg-muted/50 p-2 text-xs select-all">
              {enrollment.secret}
            </code>
          </div>
        </div>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="totp-code">Authentication code</Label>
          <Input
            id="totp-code"
            ref={codeInput}
            className="erp-auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
            aria-invalid={codeError !== null}
            aria-describedby={codeError ? "totp-code-error" : undefined}
            required
          />
          {codeError ? (
            <p id="totp-code-error" role="alert" className="text-destructive text-xs">
              {codeError}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify and turn on"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setEnrollment(null)}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        Not set up. Add a 6-digit code from an authenticator app to every sign-in.
      </p>
      <Button size="sm" onClick={() => void startSetup()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Set up"}
      </Button>
    </div>
  )
}
