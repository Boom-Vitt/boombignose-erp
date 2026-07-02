"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Mail } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { sendInvoiceEmail } from "../email-actions"

/**
 * "Email invoice" — sends the invoice to the client's contact email with a link
 * to its PDF and logs the activity. Surfaces the "not configured" and "no client
 * email" cases as friendly toasts rather than errors.
 */
export function EmailInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
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
