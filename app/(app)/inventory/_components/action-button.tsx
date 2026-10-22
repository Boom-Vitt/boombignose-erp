"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function InventoryAction({ action, label, variant = "outline" }: { action: () => Promise<{ error?: string }>; label: string; variant?: "default" | "outline" }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  const router = useRouter()
  return <div><Button variant={variant} size="sm" disabled={pending} onClick={() => start(async () => {
    const result = await action()
    setError(result.error ?? "")
    if (!result.error) router.refresh()
  })}>{pending ? "Saving…" : label}</Button>{error && <p role="alert" className="text-destructive text-sm">{error}</p>}</div>
}
