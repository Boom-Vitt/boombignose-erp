"use client"

import Link from "next/link"
import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AuthFrame } from "@/components/auth/auth-frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { safeRedirectPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/client"

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const intendedPath = safeRedirectPath(params.get("redirect"))
  const errorMessage = params.get("error")
  const resetComplete = params.get("reset") === "1"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)

    if (error) {
      toast.error("We couldn't sign you in", {
        description: "Check your email and password, then try again.",
      })
      return
    }

    router.replace(`/onboarding?next=${encodeURIComponent(intendedPath)}`)
    router.refresh()
  }

  return (
    <AuthFrame title="Welcome back" description="Sign in to keep your business moving with focus.">
      {errorMessage ? (
        <div className="mb-5 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{errorMessage}</div>
      ) : null}
      {resetComplete ? (
        <div className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700">Password updated. You can sign in now.</div>
      ) : null}
      <form className="space-y-5" onSubmit={signIn}>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-slate-700">Work email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" className="h-11 border-slate-200 bg-white px-3 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium text-slate-700">Password</Label>
            <Link href="/forgot-password" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">Forgot password?</Link>
          </div>
          <div className="relative">
            <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" className="h-11 border-slate-200 bg-white px-3 pr-11 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition-colors hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="h-11 w-full bg-slate-950 text-sm hover:bg-slate-800" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <>Continue to ANY ERP <ArrowRight className="size-4" /></>}
        </Button>
      </form>
      <p className="mt-7 text-center text-sm text-slate-500">New to ANY ERP? <Link href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-500">Create your workspace</Link></p>
    </AuthFrame>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
