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
import { LostReasonDialog, type LostReason } from "./lost-reason-dialog"

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
  dealTitle,
  stage,
  lostReasons,
  canManageReasons,
}: {
  dealId: string
  dealTitle: string
  stage: Enums<"deal_stage">
  lostReasons: LostReason[]
  canManageReasons: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState<Enums<"deal_stage">>(stage)
  const [shownStage, setShownStage] = useState(stage)
  const [isPending, startTransition] = useTransition()
  const [askingReason, setAskingReason] = useState(false)
  // The status bar can move the stage too, so follow the refreshed prop.
  if (stage !== shownStage) {
    setShownStage(stage)
    setValue(stage)
  }

  function save(nextStage: Enums<"deal_stage">, prev: Enums<"deal_stage">, lostReasonId?: string) {
    setValue(nextStage)
    return new Promise<{ error?: string }>((done) =>
      startTransition(async () => {
        const res = await updateDealStage(dealId, nextStage, { lostReasonId })
        done(res)
        if (res?.error) {
          setValue(prev)
          toast.error(res.error)
          return
        }
        toast.success("Stage updated")
        router.refresh()
      })
    )
  }

  return (
    <>
      <Select
        items={STAGES}
        value={value}
        onValueChange={(next) => {
          const nextStage = next as Enums<"deal_stage">
          if (nextStage === "lost") setAskingReason(true)
          else void save(nextStage, value)
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
      <LostReasonDialog
        open={askingReason}
        onOpenChange={setAskingReason}
        dealTitle={dealTitle}
        reasons={lostReasons}
        canManage={canManageReasons}
        onConfirm={async (lostReasonId) => {
          const res = await save("lost", value, lostReasonId)
          if (!res.error) setAskingReason(false)
          return res
        }}
      />
    </>
  )
}
