"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import type { Enums } from "@/lib/types/database"
import { updateDealStage } from "../actions"

const STAGES: { value: Enums<"deal_stage">; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "discovery", label: "Discovery" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
]

export function ChangeStageSelect({
  dealId,
  stage,
}: {
  dealId: string
  stage: Enums<"deal_stage">
}) {
  const router = useRouter()
  const [value, setValue] = useState<Enums<"deal_stage">>(stage)
  const [isPending, startTransition] = useTransition()

  return (
    <Select
      items={STAGES}
      value={value}
      onValueChange={(next) => {
        const nextStage = next as Enums<"deal_stage">
        const prev = value
        setValue(nextStage)
        startTransition(async () => {
          const res = await updateDealStage(dealId, nextStage)
          if (res?.error) {
            setValue(prev)
            toast.error(res.error)
            return
          }
          toast.success("Stage updated")
          router.refresh()
        })
      }}
      disabled={isPending}
    >
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
