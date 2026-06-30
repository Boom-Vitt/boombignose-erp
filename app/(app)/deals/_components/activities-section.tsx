"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/empty-state"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { Enums } from "@/lib/types/database"
import { addActivity, toggleActivityDone } from "../actions"

type Activity = {
  id: string
  type: Enums<"activity_type">
  body: string | null
  due_date: string | null
  done: boolean
}

const TYPES: { value: Enums<"activity_type">; label: string }[] = [
  { value: "follow_up", label: "Follow-up" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
]

const TYPE_LABEL: Record<Enums<"activity_type">, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  follow_up: "Follow-up",
}

export function ActivitiesSection({
  dealId,
  activities,
  today,
}: {
  dealId: string
  activities: Activity[]
  today: string
}) {
  const router = useRouter()
  const [type, setType] = useState<Enums<"activity_type">>("follow_up")
  const [body, setBody] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [isPending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const res = await addActivity({ dealId, type, body, dueDate })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      setBody("")
      setDueDate("")
      setType("follow_up")
      toast.success("Activity added")
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="activity-type">Type</Label>
            <Select
              items={TYPES}
              value={type}
              onValueChange={(v) => setType(v as Enums<"activity_type">)}
            >
              <SelectTrigger id="activity-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-due">Due date</Label>
            <Input
              id="activity-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-body">Notes</Label>
          <Textarea
            id="activity-body"
            rows={2}
            placeholder="What needs to happen?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <Button type="button" onClick={submit} disabled={isPending}>
          Add activity
        </Button>
      </div>

      {activities.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No activities yet"
          description="Log a call, email, or follow-up to keep this deal moving."
          className="border-0 p-6"
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {activities.map((a) => {
            const overdue = !a.done && a.due_date != null && a.due_date < today
            const dueToday = !a.done && a.due_date === today
            return (
              <li key={a.id} className="flex items-start gap-3 p-3">
                <ToggleDone id={a.id} done={a.done} dealId={dealId} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                      {TYPE_LABEL[a.type]}
                    </span>
                    {a.due_date ? (
                      <span
                        className={cn(
                          "text-xs",
                          overdue
                            ? "font-medium text-red-600 dark:text-red-400"
                            : dueToday
                              ? "font-medium text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {overdue ? "Overdue · " : dueToday ? "Due today · " : "Due "}
                        {a.due_date}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      "text-sm",
                      a.done && "text-muted-foreground line-through"
                    )}
                  >
                    {a.body ?? "—"}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ToggleDone({
  id,
  done,
  dealId,
}: {
  id: string
  done: boolean
  dealId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <Checkbox
      checked={done}
      disabled={isPending}
      className="mt-0.5"
      aria-label={done ? "Mark not done" : "Mark done"}
      onCheckedChange={(checked) => {
        startTransition(async () => {
          const res = await toggleActivityDone(id, checked === true, dealId)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          router.refresh()
        })
      }}
    />
  )
}
