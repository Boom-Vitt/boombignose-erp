"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { cancelRecordActivity } from "@/lib/record-history/actions"

export function ActivityCancel({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  function cancel() {
    setError("")
    startTransition(async () => {
      try {
        const result = await cancelRecordActivity(id)
        if (result.error) { setError(result.error); return }
        toast.success("Activity cancelled")
        setOpen(false)
      } catch { setError("Unable to cancel the activity. Please try again.") }
    })
  }
  return <AlertDialog open={open} onOpenChange={value => { setOpen(value); if (!value) setError("") }}>
    <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>Cancel</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel this activity?</AlertDialogTitle>
        <AlertDialogDescription>The planned activity is removed. This cannot be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Keep activity</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={pending} onClick={cancel}>{pending ? "Cancelling…" : "Cancel activity"}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
