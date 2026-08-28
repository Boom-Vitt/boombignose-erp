"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { requestPasswordReset } from "@/app/forgot-password/actions"
import { AuthFrame } from "@/components/auth/auth-frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    const result = await requestPasswordReset(email)
    setLoading(false)
    if (!result.ok) {
      toast.error("We couldn't send the link", { description: result.error })
      return
    }
    setSent(true)
  }

  return (
    <AuthFrame eyebrow="ACCOUNT RECOVERY" title={sent ? "Check your inbox" : "Reset your password"} description={sent ? "If an ANY ERP account matches that email, a secure reset link is on its way." : "Enter your work email and we’ll send a secure reset link."}>
      {sent ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-sm leading-6 text-emerald-900"><CheckCircle2 className="mb-3 size-6 text-emerald-600" />For your security, we don’t confirm whether an account exists. Check your inbox for the next step.</div>
      ) : (
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="space-y-2"><Label htmlFor="email" className="text-sm font-medium text-slate-700">Work email</Label><Input id="email" type="email" autoComplete="email" placeholder="you@company.com" className="h-11 border-slate-200 bg-white px-3 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <Button type="submit" className="h-11 w-full bg-slate-950 hover:bg-slate-800" disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : "Send reset link"}</Button>
        </form>
      )}
      <Link href="/login" className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Back to sign in</Link>
    </AuthFrame>
  )
}
