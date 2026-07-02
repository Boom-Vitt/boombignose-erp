"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Play, Pause, Ban, ReceiptText, Trash2 } from "lucide-react"
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

import {
  setSubscriptionStatus,
  generateInvoiceNow,
  deleteSubscription,
} from "../subscription-actions"

type Status = Enums<"subscription_status">

export function SubscriptionControls({
  id,
  status,
  canManage,
}: {
  id: string
  status: Status
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)

  function changeStatus(next: Status) {
    startTransition(async () => {
      const res = await setSubscriptionStatus({ id, status: next })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Subscription ${next}`)
      router.refresh()
    })
  }

  function generate() {
    startTransition(async () => {
      const res = await generateInvoiceNow({ id })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success("Invoice generated")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => changeStatus("active")}
        >
          <Play /> Activate
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => changeStatus("paused")}
        >
          <Pause /> Pause
        </Button>
      )}

      {status !== "cancelled" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => changeStatus("cancelled")}
        >
          <Ban /> Cancel
        </Button>
      ) : null}

      {canManage ? (
        <>
          <Button size="sm" disabled={pending} onClick={generate}>
            <ReceiptText /> Generate invoice now
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
