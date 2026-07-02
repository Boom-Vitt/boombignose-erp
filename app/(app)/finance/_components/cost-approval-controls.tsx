"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CostApprovalStatusBadge } from "@/components/status-badge"
import type { Enums } from "@/lib/types/database"

import { approveCost, rejectCost } from "../cost-approval-actions"

export function CostApprovalControls({
  id,
  label,
  status,
}: {
  id: string
  label: string
  status: Enums<"cost_approval_status">
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(
    action: (input: { id: string }) => Promise<{ error?: string }>,
    successMsg: string
  ) {
    startTransition(async () => {
      const res = await action({ id })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success(successMsg)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <CostApprovalStatusBadge status={status} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Approve ${label}`}
        disabled={pending || status === "approved"}
        onClick={() => run(approveCost, "Cost approved")}
      >
        <Check className="text-emerald-600 dark:text-emerald-400" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Reject ${label}`}
        disabled={pending || status === "rejected"}
        onClick={() => run(rejectCost, "Cost rejected")}
      >
        <X className="text-red-600 dark:text-red-400" />
      </Button>
    </div>
  )
}
