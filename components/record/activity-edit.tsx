"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { updateRecordActivity } from "@/lib/record-history/actions"
import type { Activity } from "@/lib/record-history/model"
import { ActivityFields, readActivityFields, type Person } from "./activity-fields"

export function ActivityEdit({ activity, people, userId }: {
  activity: Pick<Activity, "id" | "type" | "due_date" | "owner" | "body">
  people: Person[]
  userId: string
}) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  function submit(form: HTMLFormElement) {
    const data = new FormData(form)
    setError("")
    startTransition(async () => {
      try {
        const result = await updateRecordActivity({ id: activity.id, ...readActivityFields(data) })
        if (result.error) { setError(result.error); return }
        toast.success("Activity updated")
        setOpen(false)
      } catch { setError("Unable to update the activity. Please try again.") }
    })
  }
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setError("") }}>
    <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Edit activity</DialogTitle>
        <DialogDescription>Change the type, due date, assignee or summary of this planned activity.</DialogDescription>
      </DialogHeader>
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); submit(event.currentTarget) }}>
        <ActivityFields idPrefix={formId} people={people} defaults={{
          type: activity.type, dueDate: activity.due_date ?? "", summary: activity.body ?? "",
          owner: people.some(person => person.id === activity.owner) ? activity.owner! : userId,
        }} />
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Close</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
