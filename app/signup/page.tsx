"use client"

import Link from "next/link"
import { useState } from "react"
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { signUp } from "@/app/signup/actions"
import { AuthFrame } from "@/components/auth/auth-frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { validatePassword } from "@/lib/auth/password"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [workspaceName, setWorkspaceName] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmationNeeded, setConfirmationNeeded] = useState(false)
  const policy = validatePassword(password)
  const showPolicy = password.length > 0 && !policy.ok

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!policy.ok) {
      toast.error("Choose a stronger password", { description: policy.issues.join(" ") })
      return
    }
    setLoading(true)
    const result = await signUp({ email, password, workspaceName })
    setLoading(false)
    if (!result.ok) {
      toast.error("We couldn't create your account", { description: result.error })
      return
    }
    if (result.requiresEmailConfirmation) {
      setConfirmationNeeded(true)
      return
    }
    window.location.assign("/onboarding")
  }

  if (confirmationNeeded) {
    return (
      <AuthFrame eyebrow="ONE LAST STEP" title="Check your inbox" description="We sent a secure confirmation link to activate your ANY ERP account.">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <CheckCircle2 className="mb-3 size-6 text-emerald-600" />
          <p className="text-sm leading-6 text-emerald-900">Open the email sent to <strong>{email}</strong>, then follow the link to set up your workspace.</p>
        </div>
        <p className="mt-7 text-center text-sm text-slate-500">Already confirmed? <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">Sign in</Link></p>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame eyebrow="START YOUR WORKSPACE" title="Make work feel lighter" description="Create a secure home for your customers, delivery, and cash flow.">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="workspace" className="text-sm font-medium text-slate-700">Workspace name</Label>
          <Input id="workspace" autoComplete="organization" placeholder="Acme Studio" className="h-11 border-slate-200 bg-white px-3 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-slate-700">Work email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" className="h-11 border-slate-200 bg-white px-3 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium text-slate-700">Create a password</Label>
          <div className="relative">
            <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="At least 10 characters" className="h-11 border-slate-200 bg-white px-3 pr-11 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={showPolicy} required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition-colors hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
          {showPolicy ? <ul className="space-y-1 text-xs text-rose-600">{policy.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="text-xs text-slate-500">Use 10+ characters with uppercase, lowercase, and a number.</p>}
        </div>
        <Button type="submit" className="mt-2 h-11 w-full bg-slate-950 text-sm hover:bg-slate-800" disabled={loading || !policy.ok || workspaceName.trim().length < 2}>{loading ? <Loader2 className="size-4 animate-spin" /> : "Create secure workspace"}</Button>
      </form>
      <p className="mt-7 text-center text-sm text-slate-500">Already have an account? <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">Sign in</Link></p>
    </AuthFrame>
  )
}
