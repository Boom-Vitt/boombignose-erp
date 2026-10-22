"use client"

import { useRef, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { FileOutput } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useRecordGuard } from "@/components/record/record-guard"
import { quoteConversionKey } from "@/lib/workflows/service"

import { convertQuoteToInvoice } from "../actions"

export function ConvertQuoteButton({
  quoteId,
  orgId,
  label,
  variant,
}: {
  quoteId: string
  orgId: string
  label: string
  variant: "default" | "outline"
}) {
  const [pending, startTransition] = useTransition()
  const { busy, run } = useRecordGuard()
  const conversionRequest = useRef<{ scope: string; key: string } | null>(null)

  function convert() {
    startTransition(() => run(async () => {
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
    }))
  }

  return (
    <Button size="sm" variant={variant} disabled={pending || busy} onClick={convert}>
      <FileOutput /> {label}
    </Button>
  )
}
