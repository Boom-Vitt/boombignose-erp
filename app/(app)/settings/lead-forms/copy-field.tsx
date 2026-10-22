"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const [message, setMessage] = useState("")
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} readOnly value={value} rows={2} onFocus={event => event.target.select()} />
      <Button type="button" variant="outline" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setMessage("Copied") }
        catch { setMessage("Select the text above and copy it manually.") }
      }}>Copy {label.toLowerCase()}</Button>
      <p role="status" className="text-muted-foreground text-sm">{message}</p>
    </div>
  )
}
