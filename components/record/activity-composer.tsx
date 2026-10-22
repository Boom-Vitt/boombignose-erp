"use client"

import { useId, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { attachRecordFile, logRecordNote, scheduleRecordActivity } from "@/lib/record-history/actions"
import { ACTIVITY_LABELS, type RecordRef } from "@/lib/record-history/model"
import { ATTACHMENT_TYPES } from "@/lib/record-history/input"

export function ActivityComposer({ recordType, recordId, people, userId }: RecordRef & { people: { id: string; name: string }[]; userId: string }) {
  const id = useId()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const ref = { recordType, recordId }
  function submit(form: HTMLFormElement, kind: "note" | "activity" | "file") {
    const data = new FormData(form)
    setError("")
    setMessage("")
    startTransition(async () => {
      try {
        const result = kind === "note" ? await logRecordNote({ ...ref, body: data.get("body") })
          : kind === "activity" ? await scheduleRecordActivity({ ...ref, type: data.get("type"), dueDate: data.get("dueDate"), owner: data.get("owner"), summary: data.get("summary") })
            : await attachRecordFile(data)
        if (result.error) { setError(result.error); return }
        form.reset()
        setMessage(kind === "note" ? "Note saved" : kind === "activity" ? "Activity scheduled" : "File attached")
      } catch { setError("Unable to save. Please try again.") }
    })
  }
  return <div className="rounded-lg border p-4">
    <Tabs defaultValue="note">
      <TabsList aria-label="Record history actions" className="mb-4">
        <TabsTrigger value="note">Log note</TabsTrigger>
        <TabsTrigger value="activity">Schedule activity</TabsTrigger>
        <TabsTrigger value="file">Attach file</TabsTrigger>
      </TabsList>
      <TabsContent value="note">
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit(event.currentTarget, "note") }}>
          <Label htmlFor={`${id}-body`}>Internal note</Label>
          <Textarea id={`${id}-body`} name="body" required maxLength={20000} placeholder="Add context for your team" />
          <Button disabled={pending} type="submit">Log note</Button>
        </form>
      </TabsContent>
      <TabsContent value="activity">
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); submit(event.currentTarget, "activity") }}>
          <div className="space-y-2"><Label htmlFor={`${id}-type`}>Type</Label>
            <Select name="type" defaultValue="follow_up" items={Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }))}>
              <SelectTrigger id={`${id}-type`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ACTIVITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor={`${id}-due`}>Due date</Label><Input id={`${id}-due`} name="dueDate" type="date" required /></div>
          <div className="space-y-2"><Label htmlFor={`${id}-owner`}>Assignee</Label>
            <Select name="owner" defaultValue={userId} items={people.map(person => ({ value: person.id, label: person.name }))}>
              <SelectTrigger id={`${id}-owner`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{people.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-3"><Label htmlFor={`${id}-summary`}>Summary</Label><Input id={`${id}-summary`} name="summary" required maxLength={2000} /></div>
          <Button disabled={pending} type="submit" className="justify-self-start">Schedule activity</Button>
        </form>
      </TabsContent>
      <TabsContent value="file">
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit(event.currentTarget, "file") }}>
          <input type="hidden" name="recordType" value={recordType} /><input type="hidden" name="recordId" value={recordId} />
          <Label htmlFor={`${id}-file`}>Attachment</Label>
          <Input id={`${id}-file`} name="file" type="file" accept={ATTACHMENT_TYPES.join(",")} required aria-describedby={`${id}-file-help`} />
          <p id={`${id}-file-help`} className="text-muted-foreground text-xs">PDF, JPEG, PNG, WebP, text, or CSV. Maximum 10 MB. Visible to your workspace.</p>
          <Button disabled={pending} type="submit">Attach file</Button>
        </form>
      </TabsContent>
    </Tabs>
    {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
    {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
  </div>
}
