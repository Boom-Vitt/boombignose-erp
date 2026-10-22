"use client"

import { useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ReceiptText, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
import type { Enums } from "@/lib/types/database"
import { beginInvoiceRequest, readInvoiceRequest, acknowledgeInvoiceRequest } from "@/lib/billing/occurrence-command"

import { generateInvoiceNow, deleteSubscription } from "../subscription-actions"

type Status = Enums<"subscription_status">

function subscribeToRequests(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener("erp.subscription.request", onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener("erp.subscription.request", onChange)
  }
}

export function SubscriptionControls({
  id,
  orgId,
  status,
  canManage,
  occurrence,
  isDue,
}: {
  id: string
  orgId: string
  status: Status
  canManage: boolean
  occurrence: string
  isDue: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const unacknowledged = useSyncExternalStore(subscribeToRequests, () => {
    try { return readInvoiceRequest(sessionStorage, orgId, id)?.occurrence ?? null } catch { return null }
  }, () => null)

  function generate() {
    startTransition(async () => {
      try {
        const command = beginInvoiceRequest(sessionStorage, orgId, id, occurrence)
        window.dispatchEvent(new Event("erp.subscription.request"))
        const res = await generateInvoiceNow({ id, occurrence: command.occurrence })
        if (res?.error) { toast.error(res.error); return }
        acknowledgeInvoiceRequest(sessionStorage, orgId, id, command.occurrence)
        window.dispatchEvent(new Event("erp.subscription.request"))
        toast.success("Scheduled invoice draft ready")
        router.refresh()
      } catch {
        toast.error("Could not confirm the invoice request. Retry in this tab.")
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canManage ? (
        <>
          <Button size="sm" disabled={pending || (!isDue && !unacknowledged) || status !== "active"} onClick={generate}>
            <ReceiptText /> {unacknowledged ? `Retry invoice for ${unacknowledged}` : "Generate scheduled invoice"}
          </Button>

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  aria-label="Delete subscription"
                >
                  <Trash2 className="text-muted-foreground" /> Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this subscription?</AlertDialogTitle>
                <AlertDialogDescription>
                  This subscription will be permanently removed. Invoices already
                  generated from it are kept. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault()
                    startTransition(async () => {
                      const res = await deleteSubscription({ id })
                      if (res?.error) {
                        toast.error(res.error)
                        return
                      }
                      toast.success("Subscription deleted")
                    })
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  )
}
