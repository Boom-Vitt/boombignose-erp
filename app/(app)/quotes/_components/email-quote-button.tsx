"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Mail } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { sendQuoteEmail } from "../email-actions"

/**
 * "Email quote" — sends the quote to the client's contact email with a link to
 * its PDF and logs the activity. Surfaces the "not configured" and "no client
 * email" cases as friendly toasts rather than errors.
 */
export function EmailQuoteButton({ quoteId }: { quoteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await sendQuoteEmail(quoteId)
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
          toast.success("Quote emailed to the client")
          router.refresh()
        })
      }
    >
      <Mail /> {pending ? "Sending…" : "Email quote"}
    </Button>
  )
}
