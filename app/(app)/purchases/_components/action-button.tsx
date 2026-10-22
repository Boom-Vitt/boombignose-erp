"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"

export function PurchaseAction({ action, label, variant = "outline" }: {
  action: () => Promise<{ error?: string }>
  label: string
  variant?: "default" | "outline"
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  return <div>
    <Button size="sm" variant={variant} disabled={pending} onClick={() => start(async () => {
      setError("")
      try { const result = await action(); setError(result.error ?? "") } catch { setError("Unable to complete the action. Please reload and try again.") }
    })}>{pending ? "Working…" : label}</Button>
    {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
  </div>
}
