"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Checkbox } from "@/components/ui/checkbox"
import { toggleTask, toggleMilestone } from "../actions"

export function TaskToggle({
  id,
  projectId,
  done,
  label,
}: {
  id: string
  projectId: string
  done: boolean
  label: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <Checkbox
      checked={done}
      disabled={pending}
      aria-label={label}
      onCheckedChange={(value) =>
        startTransition(async () => {
          const res = await toggleTask({ id, projectId, done: value === true })
          if (res?.error) toast.error(res.error)
        })
      }
    />
  )
}

export function MilestoneToggle({
  id,
  projectId,
  done,
  label,
}: {
  id: string
  projectId: string
  done: boolean
  label: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <Checkbox
      checked={done}
      disabled={pending}
      aria-label={label}
      onCheckedChange={(value) =>
        startTransition(async () => {
          const res = await toggleMilestone({
            id,
            projectId,
            done: value === true,
          })
          if (res?.error) toast.error(res.error)
        })
      }
    />
  )
}
