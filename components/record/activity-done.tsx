"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { completeRecordActivity } from "@/lib/record-history/actions"

export function ActivityDone({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()
  return <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => {
    try {
      const result = await completeRecordActivity(id)
      if (result.error) toast.error(result.error)
      else toast.success("Activity completed")
    } catch { toast.error("Unable to complete the activity. Please try again.") }
  })}>{pending ? "Saving…" : "Mark done"}</Button>
}
