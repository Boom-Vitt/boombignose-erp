"use client"

import { useRouter } from "next/navigation"
import { Mail } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useRecordGuard } from "@/components/record/record-guard"

import { sendInvoiceEmail } from "../email-actions"

/**
 * "Email invoice" — sends the invoice to the client's contact email with a link
 * to its PDF and logs the activity. Surfaces the "not configured" and "no client
 * email" cases as friendly toasts rather than errors.
 */
export function EmailInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const { busy, pending, run } = useRecordGuard()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() =>
        run(async () => {
          const res = await sendInvoiceEmail(invoiceId)
          if (res.reason === "not_configured") {
            toast.warning(
              "Email is not configured. Set RESEND_API_KEY to enable sending."
            )
            return
          }
          if (res.error) {
            toast.error(res.error)
            return
          }
          toast.success("Invoice emailed to the client")
          router.refresh()
        })
      }
    >
      <Mail /> {pending ? "Sending…" : "Email invoice"}
    </Button>
  )
}
