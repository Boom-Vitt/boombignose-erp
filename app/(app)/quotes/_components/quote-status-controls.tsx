"use client"

import { useRef, useTransition } from "react"
import { useRouter, unstable_rethrow } from "next/navigation"
import { Send, Check, X, FileOutput } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { Enums } from "@/lib/types/database"
import { quoteConversionKey } from "@/lib/workflows/service"

import { setQuoteStatus, convertQuoteToInvoice } from "../actions"

export function QuoteStatusControls({
  quoteId,
  orgId,
  status,
  canConvert,
}: {
  quoteId: string
  orgId: string
  status: Enums<"quote_status">
  canConvert: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const conversionRequest = useRef<{ scope: string; key: string } | null>(null)

  function changeStatus(next: Exclude<Enums<"quote_status">, "converted">, message: string) {
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
      // Keep the same command identity after an error or an uncertain response.
      const scope = `${orgId}:${quoteId}`
      if (conversionRequest.current?.scope !== scope) {
        let key: string
        try {
          key = quoteConversionKey(window.sessionStorage, scope, () => crypto.randomUUID())
        } catch {
          key = crypto.randomUUID()
        }
        conversionRequest.current = { scope, key }
      }
      try {
        const res = await convertQuoteToInvoice({ id: quoteId, key: conversionRequest.current.key })
        // On success the action redirects; only errors return here.
        if (res?.error) toast.error(res.error)
      } catch (error) {
        unstable_rethrow(error)
        toast.error("The conversion result could not be confirmed. Retry to recover the same invoice.")
      }
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
          <FileOutput /> Create project and draft invoice
        </Button>
      ) : null}
    </div>
  )
}
