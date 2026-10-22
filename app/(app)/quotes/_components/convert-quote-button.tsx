"use client"

import { useRef, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { FileOutput } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { quoteConversionKey } from "@/lib/workflows/service"

import { convertQuoteToInvoice } from "../actions"

export function ConvertQuoteButton({
  quoteId,
  orgId,
  label,
  variant,
  request,
  revision,
  disabled,
}: {
  quoteId: string
  orgId: string
  label: string
  variant: "default" | "outline"
  request?: Omit<Parameters<typeof convertQuoteToInvoice>[0], "id" | "key">
  revision?: string
  disabled?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const conversionRequest = useRef<{ scope: string; key: string } | null>(null)

  function convert() {
    startTransition(async () => {
      // Keep the same command identity after an error or an uncertain response.
      const scope = `${orgId}:${quoteId}${revision ? `:${revision}:${JSON.stringify(request ?? {})}` : ""}`
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
        const res = await convertQuoteToInvoice({ id: quoteId, key: conversionRequest.current.key, ...request })
        // On success the action redirects; only errors return here.
        if (res?.error) toast.error(res.error)
      } catch (error) {
        unstable_rethrow(error)
        toast.error("The conversion result could not be confirmed. Retry to recover the same invoice.")
      }
    })
  }

  return (
    <Button size="sm" variant={variant} disabled={pending || disabled} onClick={convert}>
      <FileOutput /> {label}
    </Button>
  )
}
