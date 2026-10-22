"use client"

import { useState, useTransition } from "react"
import type { FormEvent } from "react"
import type { Tables } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { saveVendor } from "../actions"

export function VendorForm({ vendor }: { vendor?: Tables<"vendors"> }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    start(async () => {
      const result = await saveVendor(vendor?.id ?? null, { ...Object.fromEntries(form), active: form.has("active") })
      setError(result.error ?? "")
    })
  }
  return <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-xl border p-5">
    {([ ["name", "Name", "text"], ["tax_id", "Tax ID", "text"], ["email", "Email", "email"], ["phone", "Phone", "tel"] ] as const).map(([name, label, type]) => <div key={name} className="space-y-2">
      <Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required={name === "name"} maxLength={name === "email" ? 320 : name === "name" ? 200 : 80} defaultValue={vendor?.[name] ?? ""} />
    </div>)}
    <div className="space-y-2"><Label htmlFor="address">Address</Label><Textarea id="address" name="address" maxLength={2000} defaultValue={vendor?.address ?? ""} /></div>
    <div className="space-y-2"><Label htmlFor="payment_terms_days">Payment terms (days)</Label><Input id="payment_terms_days" name="payment_terms_days" type="number" min="0" max="3650" step="1" required defaultValue={vendor?.payment_terms_days ?? 30} /></div>
    <div className="space-y-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" maxLength={10000} defaultValue={vendor?.notes ?? ""} /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={vendor?.active ?? true} />Active</label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={pending} type="submit">{pending ? "Saving…" : vendor ? "Save vendor" : "Create vendor"}</Button>
  </form>
}
