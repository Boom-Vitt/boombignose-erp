"use client"

import { Suspense, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { mfaPath, needsMfa } from "@/lib/auth/mfa"
import { authLinkErrorMessage } from "@/lib/auth/password"
import { createClient } from "@/lib/supabase/client"
import { safeReturnPath, withReturnPath } from "@/lib/supabase/redirect"
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

// Local-dev convenience, off by default: the demo button renders only when both
// vars are set at build time. Never set them for a real deployment.
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_LOGIN_EMAIL
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_LOGIN_PASSWORD

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirectTo = safeReturnPath(params.get("redirect"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const linkError = authLinkErrorMessage(params.get("error"))

  async function signIn(em: string, pw: string) {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    if (error) {
      setLoading(false)
      setError(error.message)
      // The disabled submit button drops focus; put it back for the retry.
      requestAnimationFrame(() => passwordInput.current?.focus())
      return
    }
    // Stay disabled through navigation so a second click cannot sign in twice.
    router.push(needsMfa(data.user.factors, data.session.access_token) ? mfaPath(redirectTo) : redirectTo)
    router.refresh()
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle className="text-xl">BoomBigNose Company OS</CardTitle>
        <CardDescription>Sign in to your workspace.</CardDescription>
        {linkError ? <p role="alert" className="text-destructive pt-1 text-sm">{linkError}</p> : null}
      </CardHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void signIn(email, password)
        }}
      >
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="erp-auth-link text-xs">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              ref={passwordInput}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error !== null}
              aria-describedby={error ? "signin-error" : undefined}
              required
            />
            {error ? (
              <p id="signin-error" role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
          </div>
        </CardContent>
        <CardFooter className="mt-2 flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
          </Button>
          {DEMO_EMAIL && DEMO_PASSWORD ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={() => void signIn(DEMO_EMAIL, DEMO_PASSWORD)}
            >
              Use demo account
            </Button>
          ) : null}
          <p className="text-muted-foreground text-center text-xs">
            New to BoomBigNose?{" "}
            <Link href={withReturnPath("/signup", params.get("redirect"))} className="erp-auth-link">
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
