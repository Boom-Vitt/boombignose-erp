"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cancelQuoteInvoice } from "../actions"

export function CancelQuoteInvoiceButton({ quoteId, invoiceId, number }: { quoteId: string; invoiceId: string; number: string }) {
  const [pending, startTransition] = useTransition()
  return <Button variant="outline" size="sm" disabled={pending} aria-label={`Cancel draft ${number}`} onClick={() => startTransition(async () => {
    try {
      const result = await cancelQuoteInvoice({ quoteId, invoiceId })
      if (result.error) toast.error(result.error)
      else toast.success("Draft cancelled. Its quote quantities are available again.")
    } catch {
      toast.error("Cancellation could not be confirmed. Reload the quote before retrying.")
    }
  })}>Cancel draft</Button>
}
