"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateFinanceLockDate } from "@/app/(app)/finance/actions"

export function FinanceLockForm({ orgId, lockDate }: { orgId: string; lockDate: string }) {
  const [value, setValue] = useState(lockDate)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const result = await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: value })
        if (result.error) { toast.error(result.error); return }
        toast.success("Finance lock date saved")
        router.refresh()
      } catch { toast.error("Could not confirm the finance lock. Reload before retrying.") }
    })
  }}>
    <label htmlFor="finance-lock-date" className="block text-sm font-medium">Lock transactions through</label>
    <Input id="finance-lock-date" type="date" value={value} disabled={pending} aria-describedby="finance-lock-help" onChange={event => setValue(event.target.value)} />
    <p id="finance-lock-help" className="text-sm text-muted-foreground">Invoice issues, receipts and corrections dated on or before this date are blocked. Leave blank to keep all periods open.</p>
    <Button type="submit" disabled={pending}>Save finance lock</Button>
  </form>
}
