"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { updatePaymentReviewPolicy } from "@/app/(app)/finance/correction-actions"

export function PaymentReviewForm({ orgId, required }: { orgId: string; required: boolean }) {
  const [value, setValue] = useState(required)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const result = await updatePaymentReviewPolicy({ expectedOrgId: orgId, required: value })
        if (result.error) { toast.error(result.error); return }
        toast.success("Payment review policy saved"); router.refresh()
      } catch { toast.error("Could not confirm policy update. Reload before retrying.") }
    })
  }}><label className="flex gap-2 items-center"><input type="checkbox" disabled={pending} checked={value} onChange={event => setValue(event.target.checked)} />Require a different staff member to verify reported payments</label>
    <p className="text-sm text-muted-foreground">When enabled, the person reporting a receipt cannot verify it. Another owner or admin must review the bank evidence.</p>
    <Button type="submit" disabled={pending}>Save payment review policy</Button>
  </form>
}
