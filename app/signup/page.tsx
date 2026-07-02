"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { signUp } from "@/app/signup/actions"
import { validatePassword } from "@/lib/auth/password"
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

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Live policy check so the user sees every failing rule before submitting.
  const policy = validatePassword(password)
  const showPolicy = password.length > 0 && !policy.ok

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    const check = validatePassword(password)
    if (!check.ok) {
      toast.error("Choose a stronger password", {
        description: check.issues.join(" "),
      })
      return
    }

    setLoading(true)
    const result = await signUp({ email, password })
    setLoading(false)

    if (!result.ok) {
      toast.error("Sign up failed", { description: result.error })
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="text-primary size-5" />
              <CardTitle className="text-xl">Check your email</CardTitle>
            </div>
            <CardDescription>
              We sent a confirmation link to{" "}
              <span className="font-medium">{email}</span>. Click it to confirm
              your account, then sign in.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full"
              render={<Link href="/login" />}
            >
              Back to sign in
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>
            Sign up for the BoomBigNose Company OS.
          </CardDescription>
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={showPolicy}
                required
              />
              {showPolicy ? (
                <ul className="text-destructive space-y-1 text-xs">
                  {policy.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">
                  At least 10 characters with upper, lower, and a number.
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter className="mt-2 flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !policy.ok || email.length === 0}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Create account"
              )}
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              Already have an account?{" "}
              <Link href="/login" className="underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
