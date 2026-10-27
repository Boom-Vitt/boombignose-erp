"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { stepUpPath } from "@/lib/auth/totp"
import { safeReturnPath } from "@/lib/supabase/redirect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
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
  const params = useSearchParams()
  const redirectTo = safeReturnPath(params.get("redirect"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function signIn(em: string, pw: string) {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    if (error) {
      setLoading(false)
      toast.error("Sign in failed", { description: error.message })
      return
    }
    const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (!level.error && level.data) {
      const next = stepUpPath({
        hasVerifiedTotp: level.data.nextLevel === "aal2",
        authenticatorAssuranceLevel: level.data.currentLevel,
      })
      if (next) {
        // Full load, so the cookie write is finished before the app renders.
        window.location.assign(next)
        return
      }
    }
    window.location.assign(redirectTo)
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">BoomBigNose ERP</CardTitle>
          <CardDescription>Sign in to your workspace.</CardDescription>
          {params.get("error") ? <p role="alert" className="text-destructive text-sm">{params.get("error")}</p> : null}
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
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
              No account yet?{" "}
              <Link href="/signup" className="underline underline-offset-4">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
