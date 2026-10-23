"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateBillTolerance } from "@/app/(app)/purchases/actions"

export function BillToleranceForm({ toleranceBps }: { toleranceBps: number }) {
  const [value, setValue] = useState(String(toleranceBps / 100))
  const [pending, start] = useTransition()
  const router = useRouter()
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault()
    start(async () => {
      try {
        const result = await updateBillTolerance(Math.round(Number(value) * 100))
        if (result.error) { toast.error(result.error); return }
        toast.success("Bill tolerance saved")
        router.refresh()
      } catch { toast.error("Could not save bill tolerance") }
    })
  }}>
    <label className="block">Vendor bill variance tolerance (%)<Input type="number" min="0" max="100" step="0.01" required value={value} onChange={event => setValue(event.target.value)} /></label>
    <p className="text-sm text-muted-foreground">Quantity and unit price variances above this percentage require an acceptance reason. A different declared VAT or total always requires a reason.</p>
    <Button type="submit" disabled={pending}>Save bill tolerance</Button>
  </form>
}
