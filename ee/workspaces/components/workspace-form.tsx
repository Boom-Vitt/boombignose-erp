"use client"

import { useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { provisionWorkspace } from "@/ee/workspaces/actions"
import { workspaceProvisionRequest, type WorkspaceProvisionRequest } from "@/ee/workspaces/workspace-request"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function WorkspaceForm({ userId }: { userId: string }) {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<WorkspaceProvisionRequest | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    let storage: Storage | undefined
    try { storage = window.sessionStorage } catch { /* Memory keeps this attempt retryable. */ }
    request.current = workspaceProvisionRequest(userId, name, storage, request.current)
    try {
      const result = await provisionWorkspace(request.current)
      if (result?.error) setError(result.error)
    } catch {
      setError("Unable to confirm workspace creation. Retry with the same name to continue safely.")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="workspace-name">Workspace name / ชื่อพื้นที่ทำงาน</Label>
        <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)}
          maxLength={100} required autoComplete="organization" disabled={pending}
          placeholder="Your service business" />
      </div>
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Create workspace / สร้างพื้นที่ทำงาน"}
      </Button>
    </form>
  )
}
