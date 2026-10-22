"use client"

import { useState, useSyncExternalStore, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { isRedirectError } from "next/dist/client/components/redirect-error"
import { getURLFromRedirectError } from "next/dist/client/components/redirect"
import { FileOutput } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { serviceAmountBaht } from "@/lib/workflows/service"
import { acknowledgeQuoteConversionCommand, beginQuoteConversionCommand, readQuoteConversionCommand, type QuoteConversionCommand } from "@/lib/workflows/quote-conversion-command"

import { convertQuoteToInvoice } from "../actions"

function browserStore(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}
function subscribeToRequests(change: () => void) {
  window.addEventListener("storage", change)
  return () => window.removeEventListener("storage", change)
}

export function ConvertQuoteButton({
  quoteId,
  orgId,
  label,
  variant,
  request,
  disabled,
}: {
  quoteId: string
  orgId: string
  label: string
  variant: "default" | "outline"
  request?: Omit<Parameters<typeof convertQuoteToInvoice>[0], "id" | "key">
  disabled?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [activeCommand, setActiveCommand] = useState<QuoteConversionCommand | null>(null)
  const saved = useSyncExternalStore(subscribeToRequests, () => {
    try { return JSON.stringify(readQuoteConversionCommand(browserStore(), orgId, quoteId)) } catch (error) { return `error:${error instanceof Error ? error.message : "Could not read the saved invoice request."}` }
  }, () => "null")
  const recoveryError = saved.startsWith("error:") ? saved.slice(6) : ""
  const command = activeCommand?.orgId === orgId && activeCommand.quoteId === quoteId
    ? activeCommand : recoveryError ? null : JSON.parse(saved) as QuoteConversionCommand | null

  function convert() {
    if (recoveryError || (disabled && !command)) return
    startTransition(async () => {
      let submitted: QuoteConversionCommand
      try {
        submitted = beginQuoteConversionCommand(browserStore(), orgId, quoteId, request ?? {}, () => crypto.randomUUID())
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not prepare the invoice request.")
        return
      }
      setActiveCommand(submitted)
      try {
        const res = await convertQuoteToInvoice({ id: quoteId, key: submitted.key, ...submitted.request })
        // The action acknowledges a completed conversion by redirecting to its invoice.
        if (res?.error) {
          if (res.rejected) {
            acknowledgeQuoteConversionCommand(browserStore(), orgId, quoteId, submitted.key)
            setActiveCommand(null)
          }
          toast.error(res.error)
        }
      } catch (error) {
        if (isRedirectError(error) && getURLFromRedirectError(error).startsWith("/finance/invoices/")) {
          acknowledgeQuoteConversionCommand(browserStore(), orgId, quoteId, submitted.key)
          setActiveCommand(null)
        }
        unstable_rethrow(error)
        toast.error("The conversion result could not be confirmed. Retry to recover the same invoice.")
      }
    })
  }

  return (
    <div className="space-y-2">
      {recoveryError ? <p role="status" className="text-destructive text-sm">{recoveryError}</p> : null}
      {command ? <div role="status" className="text-sm">
        <p>A saved invoice request is awaiting confirmation. Retry this original scope before creating another invoice. New form values will not be submitted.</p>
        {command.request.depositBps !== undefined ? <p>Deposit: {`${command.request.depositBps / 100}%`}</p>
          : command.request.depositSatang !== undefined ? <p>Deposit: THB {serviceAmountBaht(command.request.depositSatang)}</p>
          : command.request.lines ? <ul>{command.request.lines.map((line) => <li key={line.quote_item_id}>{line.quantity} × quote line {line.quote_item_id}</li>)}</ul>
          : <p>All remaining quantities from the original request</p>}
      </div> : null}
      <Button size="sm" variant={variant} disabled={pending || !!recoveryError || (!!disabled && !command)} onClick={convert}>
        <FileOutput /> {command ? "Retry pending invoice" : label}
      </Button>
    </div>
  )
}
