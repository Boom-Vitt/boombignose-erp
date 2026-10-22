"use client"

import { useState, useTransition, type FormEvent } from "react"
import { Constants } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { addExpenseLine } from "../actions"

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm"

export function ExpenseLineForm({ claimId, today, projects }: { claimId: string; today: string; projects: { id: string; name: string }[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    start(async () => {
      const result = await addExpenseLine({ ...values, claim_id: claimId })
      setError(result.error ?? "")
      if (!result.error) form.reset()
    })
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Add expense line</h2>
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="spent_on">Date</Label><Input id="spent_on" name="spent_on" type="date" required defaultValue={today} /></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="category">Category</Label><select id="category" name="category" defaultValue="other" className={SELECT}>{Constants.public.Enums.cost_category.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="amountBaht">Amount (THB)</Label><Input id="amountBaht" name="amountBaht" inputMode="decimal" required placeholder="0.00" /></div>
      <div className="space-y-2 sm:col-span-4"><Label htmlFor="description">Description</Label><Input id="description" name="description" maxLength={1000} required /></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="project_id">Project to re-bill (optional)</Label><select id="project_id" name="project_id" defaultValue="" className={SELECT}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add line"}</Button>
  </form>
}
