"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AuthFrame } from "@/components/auth/auth-frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { validatePassword } from "@/lib/auth/password"
import { createClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const policy = validatePassword(password)

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.replace("/login?error=Your+reset+link+is+invalid+or+expired.")
      setChecking(false)
    })
  }, [router])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!policy.ok) return
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      toast.error("We couldn't update your password", { description: error.message })
      return
    }
    await supabase.auth.signOut()
    router.replace("/login?reset=1")
    router.refresh()
  }

  return (
    <AuthFrame eyebrow="PASSWORD RESET" title="Choose a new password" description="Use a password you haven’t used for this account before.">
      {checking ? <div className="grid h-36 place-items-center"><Loader2 className="size-5 animate-spin text-indigo-600" /></div> : (
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-slate-700">New password</Label>
            <div className="relative"><Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="h-11 border-slate-200 bg-white px-3 pr-11 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
            {!policy.ok && password.length > 0 ? <ul className="space-y-1 text-xs text-rose-600">{policy.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="text-xs text-slate-500">Use 10+ characters with uppercase, lowercase, and a number.</p>}
          </div>
          <Button type="submit" className="h-11 w-full bg-slate-950 hover:bg-slate-800" disabled={checking || loading || !policy.ok}>{loading ? <Loader2 className="size-4 animate-spin" /> : "Update password"}</Button>
        </form>
      )}
    </AuthFrame>
  )
}
