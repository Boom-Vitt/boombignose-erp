"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { completeRecordActivity } from "@/lib/record-history/actions"
import { ActivityFields, readActivityFields, type Person } from "./activity-fields"

/** Schedule-next is offered only when `people` is passed, i.e. on a record page. */
export function ActivityDone({ id, people, userId }: { id: string; people?: Person[]; userId?: string }) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const fail = (message: string) => { setError(message); toast.error(message) }
  function changeOpen(value: boolean) {
    setOpen(value)
    if (!value) { setScheduling(false); setError("") }
  }
  function submit(form: HTMLFormElement) {
    const data = new FormData(form)
    setError("")
    startTransition(async () => {
      try {
        const result = await completeRecordActivity({ id, feedback: data.get("feedback"), next: scheduling ? readActivityFields(data) : undefined })
        if (result.error) { fail(result.error); return }
        toast.success(scheduling ? "Activity completed and next one scheduled" : "Activity completed")
        changeOpen(false)
      } catch { fail("Unable to complete the activity. Please try again.") }
    })
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" />}>Mark done</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Mark activity done</DialogTitle>
        <DialogDescription>Add an optional note. It is saved on the timeline entry.</DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit(event.currentTarget) }}>
        <div className="space-y-2"><Label htmlFor={`${formId}-feedback`}>Note (optional)</Label>
          <Textarea id={`${formId}-feedback`} name="feedback" maxLength={2000} placeholder="What happened?" /></div>
        {people ? <Button type="button" variant="ghost" size="sm" aria-expanded={scheduling} onClick={() => setScheduling(value => !value)}>{scheduling ? "Don't schedule a next activity" : "Schedule a next activity"}</Button> : null}
        {people && scheduling ? <div className="grid gap-3"><ActivityFields idPrefix={formId} people={people} defaults={{ owner: userId }} /></div> : null}
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => changeOpen(false)}>Close</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : scheduling ? "Done and schedule next" : "Done"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
