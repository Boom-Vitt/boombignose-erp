"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Wallet } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { portalMarkInvoicePaid } from "../portal-actions"

export function MarkInvoicePaidButton({
  token,
  invoiceId,
}: {
  token: string
  invoiceId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await portalMarkInvoicePaid({ token, invoiceId })
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Invoice marked as paid")
          router.refresh()
        })
      }
    >
      <Wallet /> Mark as paid
    </Button>
  )
}
