"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { portalMarkInvoicePaid } from "@/ee/portal/actions"

export function MarkInvoicePaidButton({ token, invoiceId }: { token: string; invoiceId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [key, setKey] = useState<string>()
  return <form className="space-y-2 min-w-48" onSubmit={e => {
    e.preventDefault()
    const requestKey = key ?? crypto.randomUUID()
    setKey(requestKey)
    startTransition(async () => {
      try {
      const result = await portalMarkInvoicePaid({token, invoiceId, amountBaht:amount, reference, key:requestKey})
      if (result.error) { toast.error(result.error); return }
      toast.success("ส่งหลักฐานแล้ว รอตรวจสอบ / Pending verification")
      router.refresh()
      } catch { toast.error("Could not confirm the report. Retry unchanged details.") }
    })
  }}>
    <Input aria-label="Reported payment amount (THB)" inputMode="decimal" placeholder="ยอดโอน (฿)" value={amount} onChange={e=>{setAmount(e.target.value); setKey(undefined)}} required />
    <Input aria-label="Customer payment reference" placeholder="วันที่และเลขอ้างอิงการโอน" value={reference} onChange={e=>{setReference(e.target.value); setKey(undefined)}} maxLength={500} required />
    <Button type="submit" size="sm" variant="outline" disabled={pending}>แจ้งชำระเงิน / Report payment</Button>
    <p className="text-xs text-muted-foreground">รอผู้ดูแลตรวจสอบก่อนตัดยอด / Subject to receipt verification</p>
  </form>
}
