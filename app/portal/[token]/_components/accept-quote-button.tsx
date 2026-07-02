"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

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

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await portalAcceptQuote({ token, quoteId })
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Quote accepted")
          router.refresh()
        })
      }
    >
      <Check /> Accept
    </Button>
  )
}
