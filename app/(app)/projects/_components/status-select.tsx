"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Enums } from "@/lib/types/database"
import { updateProjectStatus } from "../actions"

type ProjectStatus = Enums<"project_status">

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "delivered", label: "Delivered" },
  { value: "support", label: "Support" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
]

const STATUS_LABEL = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label])
) as Record<ProjectStatus, string>

export function StatusSelect({
  projectId,
  status,
}: {
  projectId: string
  status: ProjectStatus
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Select
      value={status}
      disabled={pending}
      onValueChange={(v) => {
        if (!v || v === status) return
        startTransition(async () => {
          const res = await updateProjectStatus({
            id: projectId,
            status: v as ProjectStatus,
          })
          if (res?.error) toast.error(res.error)
          else toast.success("Status updated")
        })
      }}
    >
      <SelectTrigger size="sm">
        <SelectValue>{(v: ProjectStatus) => STATUS_LABEL[v]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
