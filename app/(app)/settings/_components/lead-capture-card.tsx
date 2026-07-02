"use client"

import { useState, useTransition } from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

import { setLeadCapture } from "../actions"

export function LeadCaptureCard({
  enabled: initialEnabled,
  slug,
  appUrl,
}: {
  enabled: boolean
  slug: string
  appUrl: string
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const link = slug && appUrl ? `${appUrl}/lead/${slug}` : ""

  function handleToggle(next: boolean) {
    startTransition(async () => {
      const res = await setLeadCapture(next)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      setEnabled(next)
      toast.success(next ? "Lead capture enabled" : "Lead capture disabled")
    })
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success("Link copied")
    } catch {
      toast.error("Could not copy the link")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="lead-capture-toggle">Enable lead capture</Label>
          <p className="text-muted-foreground text-sm">
            Publish a public form that creates a new client and a lead-stage
            deal for every submission.
          </p>
        </div>
        <Switch
          id="lead-capture-toggle"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={pending}
        />
      </div>

      {enabled && link ? (
        <div className="space-y-2">
          <Label htmlFor="lead-capture-link">Public form link</Label>
          <div className="flex items-center gap-2">
            <Input id="lead-capture-link" readOnly value={link} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy lead form link"
              onClick={handleCopy}
            >
              <Copy />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Anyone with this link can submit their details. Disable to stop
            accepting new leads.
          </p>
        </div>
      ) : null}
    </div>
  )
}
