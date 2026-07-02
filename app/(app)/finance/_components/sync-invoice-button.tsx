"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { syncInvoiceToAccounting } from "../accounting-actions"

/**
 * "Sync to accounting" — pushes the invoice to the connected provider (a stub
 * in this MVP) and records the mapping. Re-clicking re-syncs idempotently.
 */
export function SyncInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await syncInvoiceToAccounting(invoiceId)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success(
            res.externalId
              ? `Synced to accounting (${res.externalId})`
              : "Synced to accounting"
          )
          router.refresh()
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Syncing…" : "Sync to accounting"}
    </Button>
  )
}
