"use client"
import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { Enums } from "@/lib/types/database"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { reviewPaymentClaim } from "../actions"

export function ReviewClaimForm({orgId,claimId,invoiceId,suggestedBaht,today}:{orgId:string;claimId:string;invoiceId:string;suggestedBaht:string;today:string}) {
  const router=useRouter()
  const [amount,setAmount]=useState(suggestedBaht)
  const [paidOn,setPaidOn]=useState(today)
  const [method,setMethod]=useState<Enums<"payment_method">>("transfer")
  const [reference,setReference]=useState("")
  const [pending,startTransition]=useTransition()
  const request=useRef<{key:string;decision:"verified"|"rejected";amountBaht:string;reference:string} | undefined>(undefined)
  function review(decision:"verified"|"rejected") {
    const current=request.current
    let key=current?.decision===decision ? current.key : undefined
    if (!key) {
      try { key=paymentCommandKey(sessionStorage, `${orgId}/${claimId}/review`, [decision,amount,reference,paidOn,method],()=>crypto.randomUUID()) }
      catch { key=crypto.randomUUID() }
    }
    const command={key,decision,amountBaht:amount,reference}
    request.current=command
    startTransition(async()=>{
      try {
      const result=await reviewPaymentClaim({claimId,invoiceId,...command,paidOn,method})
      if(result.error) { toast.error(result.error); return }
      toast.success(decision==="verified"?"ตรวจสอบและตัดยอดแล้ว / Receipt verified":"ปฏิเสธรายการแล้ว / Claim rejected")
      router.refresh()
      } catch { toast.error("Could not confirm the response. Retry unchanged details to recover the original result.") }
    })
  }
  return <div className="space-y-2">
    <Input disabled={pending} aria-label="Verified amount (THB)" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value); request.current=undefined}} />
    <Input disabled={pending} aria-label="Verification evidence reference" placeholder="Bank receipt reference or rejection reason" value={reference} onChange={e=>{setReference(e.target.value); request.current=undefined}} maxLength={500} />
    <label className="block text-sm">Bank receipt date<Input disabled={pending} type="date" max={today} value={paidOn} onChange={event=>{setPaidOn(event.target.value);request.current=undefined}} /></label>
    <label className="block text-sm">Receipt method<select disabled={pending} className="block w-full rounded border p-2 bg-background" value={method} onChange={event=>{setMethod(event.target.value as Enums<"payment_method">);request.current=undefined}}>{["transfer","promptpay","cash","card","cheque","other"].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <p className="text-xs text-muted-foreground">ตรวจสอบยอดรับเงินจริงและเลขอ้างอิงก่อนยืนยัน / Match the actual receipt before approval.</p>
    <div className="flex gap-2"><Button disabled={pending||reference.trim().length<3} onClick={()=>review("verified")}>Verify receipt</Button>
    <Button variant="outline" disabled={pending||reference.trim().length<3} onClick={()=>review("rejected")}>Reject claim</Button></div>
  </div>
}
