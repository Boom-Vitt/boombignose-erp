"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { logRecordNote } from "@/lib/record-history/actions"
import type { RecordRef } from "@/lib/record-history/model"
import { STATUS_DISPLAY, type RecordStatus } from "@/lib/record/status"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useRecordGuard } from "./record-guard"

export function TransitionButton<S extends RecordStatus>({
  label,
  to,
  transition,
  variant,
  confirm,
  reason,
  record,
}: {
  label: string
  to: S
  transition: (to: S) => Promise<{ error?: string }>
  variant: "default" | "outline"
  /** Asks first with this explanation. */
  confirm?: string
  /** Also asks why, kept as a note on `record`. */
  reason?: true
  record?: RecordRef
}) {
  const router = useRouter()
  const { busy, run } = useRecordGuard()
  const [open, setOpen] = useState(false)
  const [why, setWhy] = useState("")
  const reasonId = useId()
  const asksWhy = reason && record

  function move(note: string) {
    void run(async () => {
      const res = await transition(to)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success("Status updated")
      if (note && record) {
        const logged = await logRecordNote({ ...record, body: `${STATUS_DISPLAY[to].label}: ${note}` }).catch(() => ({ error: "failed" }))
        if (logged.error) toast.error("Status updated, but the reason was not saved. Add it as a note.")
      }
      router.refresh()
    })
  }

  if (!confirm) {
    return (
      <Button size="sm" variant={variant} disabled={busy} onClick={() => move("")}>
        {label}
      </Button>
    )
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button size="sm" variant={variant} disabled={busy} />}>{label}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>{confirm}</AlertDialogDescription>
        </AlertDialogHeader>
        {asksWhy ? (
          <div className="grid gap-2">
            <Label htmlFor={reasonId}>Reason (optional)</Label>
            <Textarea id={reasonId} value={why} maxLength={2000} onChange={(event) => setWhy(event.target.value)} />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              move(asksWhy ? why.trim() : "")
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
