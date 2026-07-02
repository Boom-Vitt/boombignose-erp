"use client"

import { useState, useTransition } from "react"
import { Copy, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

import {
  enableClientPortal,
  disableClientPortal,
  regeneratePortalToken,
} from "../portal-actions"

export function PortalShareCard({
  clientId,
  portalEnabled,
  portalToken,
  appUrl,
}: {
  clientId: string
  portalEnabled: boolean
  portalToken: string | null
  appUrl: string
}) {
  const [enabled, setEnabled] = useState(portalEnabled)
  const [token, setToken] = useState(portalToken)
  const [pending, startTransition] = useTransition()

  const link = token && appUrl ? `${appUrl}/portal/${token}` : ""

  function handleToggle(next: boolean) {
    startTransition(async () => {
      if (next) {
        const res = await enableClientPortal(clientId)
        if (res.error) {
          toast.error(res.error)
          return
        }
        setEnabled(true)
        if (res.token) setToken(res.token)
        toast.success("Client portal enabled")
      } else {
        const res = await disableClientPortal(clientId)
        if (res.error) {
          toast.error(res.error)
          return
        }
        setEnabled(false)
        toast.success("Client portal disabled")
      }
    })
  }

  function handleRegenerate() {
    startTransition(async () => {
      const res = await regeneratePortalToken(clientId)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      setEnabled(true)
      if (res.token) setToken(res.token)
      toast.success("Portal link regenerated")
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
          <Label htmlFor="portal-toggle">Enable portal</Label>
          <p className="text-muted-foreground text-sm">
            Give this client a private, read-only link to their quotes,
            invoices, and projects.
          </p>
        </div>
        <Switch
          id="portal-toggle"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={pending}
        />
      </div>

      {enabled && link ? (
        <div className="space-y-2">
          <Label htmlFor="portal-link">Portal link</Label>
          <div className="flex items-center gap-2">
            <Input id="portal-link" readOnly value={link} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy portal link"
              onClick={handleCopy}
            >
              <Copy />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Anyone with this link can view the portal. Regenerate to revoke the
            old link.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRegenerate}
            disabled={pending}
          >
            <RefreshCw /> Regenerate link
          </Button>
        </div>
      ) : null}
    </div>
  )
}
