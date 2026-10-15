"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, MailCheck } from "lucide-react"
import { toast } from "sonner"

import { authLinkErrorMessage } from "@/lib/auth/password"
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

function ForgotPasswordForm() {
  // Set by /auth/confirm when a reset link was expired, reused or opened in another browser.
  const linkError = authLinkErrorMessage(useSearchParams().get("error"))
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Same origin as this page: the PKCE verifier cookie must come back with the link.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    })
    setLoading(false)
    if (error) {
      toast.error("Could not send reset link", { description: error.message })
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MailCheck className="erp-auth-icon size-5" aria-hidden />
            <CardTitle className="text-xl">Check your email</CardTitle>
          </div>
          <CardDescription>
            If an account exists for{" "}
            <span className="font-medium">{email}</span>, we sent a link to
            reset your password.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" className="w-full" render={<Link href="/login" />}>
            Back to sign in
          </Button>
        </CardFooter>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send you a reset link.
        </CardDescription>
        {linkError ? <p role="alert" className="text-destructive pt-1 text-sm">{linkError}</p> : null}
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="mt-2 flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Send reset link"}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            Remembered it?{" "}
            <Link href="/login" className="erp-auth-link">
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </AuthShell>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}
