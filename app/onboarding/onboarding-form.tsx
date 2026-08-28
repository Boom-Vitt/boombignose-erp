"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Building2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createWorkspace } from "@/app/onboarding/actions"
import { AuthFrame } from "@/components/auth/auth-frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function OnboardingForm({ defaultName, next }: { defaultName: string; next: string }) {
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    const result = await createWorkspace({ name, next })
    setLoading(false)
    if (!result.ok) {
      toast.error("We couldn't create your workspace", { description: result.error })
      return
    }
    router.replace(result.redirectTo)
    router.refresh()
  }

  return (
    <AuthFrame eyebrow="WELCOME TO ANY ERP" title="Name your workspace" description="This is the private home for your team, customers, and operational data.">
      <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900"><Building2 className="mb-2 size-5 text-indigo-600" />You’ll be the owner and can invite teammates later.</div>
      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="space-y-2"><Label htmlFor="workspace" className="text-sm font-medium text-slate-700">Workspace name</Label><Input id="workspace" autoComplete="organization" className="h-11 border-slate-200 bg-white px-3 text-slate-950 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15" value={name} onChange={(event) => setName(event.target.value)} required /></div>
        <Button type="submit" className="h-11 w-full bg-slate-950 hover:bg-slate-800" disabled={loading || name.trim().length < 2}>{loading ? <Loader2 className="size-4 animate-spin" /> : <>Create workspace <ArrowRight className="size-4" /></>}</Button>
      </form>
    </AuthFrame>
  )
}
