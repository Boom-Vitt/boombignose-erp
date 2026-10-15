"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { EXPIRED_RESET_MESSAGE, isDeadSessionError, validatePassword } from "@/lib/auth/password"
import { createClient } from "@/lib/supabase/client"
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

/** Reached signed in from a recovery link (proxy guards it, including the TOTP step). */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)

  const policy = validatePassword(password)
  const showPolicy = password.length > 0 && !policy.ok
  const mismatch = confirm.length > 0 && confirm !== password

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!policy.ok || mismatch) return

    setLoading(true)
    const { error } = await createClient().auth.updateUser({ password })
    setLoading(false)
    if (error && isDeadSessionError(error)) {
      router.push(`/forgot-password?error=${encodeURIComponent(EXPIRED_RESET_MESSAGE)}`)
      return
    }
    if (error) {
      toast.error("Could not update password", { description: error.message })
      return
    }
    toast.success("Password updated")
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>You&apos;ll stay signed in on this device.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={showPolicy}
              aria-describedby="password-help"
              required
            />
            {showPolicy ? (
              <ul id="password-help" className="text-destructive space-y-1 text-xs">
                {policy.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : (
              <p id="password-help" className="text-muted-foreground text-xs">
                At least 10 characters with upper, lower, and a number.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "confirm-help" : undefined}
              required
            />
            {mismatch ? (
              <p id="confirm-help" className="text-destructive text-xs">
                Passwords don&apos;t match.
              </p>
            ) : null}
          </div>
        </CardContent>
        <CardFooter className="mt-2 flex-col gap-3">
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !policy.ok || confirm !== password}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Update password"}
          </Button>
        </CardFooter>
      </form>
    </AuthShell>
  )
}
