"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Send, Check, X, FileOutput } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { Enums } from "@/lib/types/database"

import { setQuoteStatus, convertQuoteToInvoice } from "../actions"

export function QuoteStatusControls({
  quoteId,
  status,
  canConvert,
}: {
  quoteId: string
  status: Enums<"quote_status">
  canConvert: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function changeStatus(next: Enums<"quote_status">, message: string) {
    startTransition(async () => {
      const res = await setQuoteStatus({ id: quoteId, status: next })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success(message)
      router.refresh()
    })
  }

  function convert() {
    startTransition(async () => {
      const res = await convertQuoteToInvoice({ id: quoteId })
      // On success the action redirects; only errors return here.
      if (res?.error) toast.error(res.error)
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => changeStatus("sent", "Quote marked as sent")}
        >
          <Send /> Mark sent
        </Button>
      ) : null}

      {status === "sent" ? (
        <>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => changeStatus("accepted", "Quote accepted")}
          >
            <Check /> Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => changeStatus("declined", "Quote declined")}
          >
            <X /> Decline
          </Button>
        </>
      ) : null}

      {status === "accepted" && canConvert ? (
        <Button size="sm" disabled={pending} onClick={convert}>
          <FileOutput /> Convert to invoice
        </Button>
      ) : null}
    </div>
  )
}
