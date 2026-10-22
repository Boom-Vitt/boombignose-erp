"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cancelDraftInvoice } from "../actions"

export function CancelDraftButton({ invoiceId }: { invoiceId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <Button className="mt-3" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
    try {
      const result = await cancelDraftInvoice({ invoiceId })
      if (result.error) { toast.error(result.error); return }
      toast.success("Draft cancelled")
      router.refresh()
    } catch { toast.error("Could not confirm cancellation. Reload before retrying.") }
  })}>Cancel draft</Button>
}
