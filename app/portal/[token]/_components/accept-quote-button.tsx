"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { portalAcceptQuote } from "../portal-actions"

export function AcceptQuoteButton({
  token,
  quoteId,
}: {
  token: string
  quoteId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [signerName, setSignerName] = useState("")
  const inputId = useId()

  const trimmed = signerName.trim()

  function handleAccept() {
    if (!trimmed) {
      toast.error("Please type your full name to accept.")
      return
    }
    startTransition(async () => {
      const res = await portalAcceptQuote({
        token,
        quoteId,
        signerName: trimmed,
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success("Quote accepted")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="w-full max-w-56 space-y-1 text-left">
        <Label htmlFor={inputId} className="text-xs font-medium">
          Type your full name to accept
        </Label>
        <Input
          id={inputId}
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !pending) {
              e.preventDefault()
              handleAccept()
            }
          }}
          placeholder="Your full name"
          autoComplete="name"
          disabled={pending}
          maxLength={200}
          aria-describedby={`${inputId}-hint`}
        />
        <p id={`${inputId}-hint`} className="text-muted-foreground text-xs">
          By typing your name you accept this quotation.
        </p>
      </div>
      <Button
        size="sm"
        disabled={pending || !trimmed}
        onClick={handleAccept}
      >
        <Check /> Accept
      </Button>
    </div>
  )
}
