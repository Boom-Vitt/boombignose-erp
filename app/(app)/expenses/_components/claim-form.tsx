"use client"

import { useState, useTransition, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createExpenseClaim } from "../actions"

export function ClaimForm() {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = Object.fromEntries(new FormData(event.currentTarget))
    start(async () => { const result = await createExpenseClaim(input); setError(result.error ?? "") })
  }
  return <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-xl border p-5">
    <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" maxLength={200} required placeholder="e.g. Client visit in Chiang Mai" /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Creating…" : "Create claim"}</Button>
  </form>
}
