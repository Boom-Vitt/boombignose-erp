"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { reviewPaymentClaim } from "../actions"

export function ReviewClaimForm({claimId,invoiceId,suggestedBaht}:{claimId:string;invoiceId:string;suggestedBaht:string}) {
  const router=useRouter()
  const [amount,setAmount]=useState(suggestedBaht)
  const [reference,setReference]=useState("")
  const [pending,startTransition]=useTransition()
  const [request,setRequest]=useState<{key:string;decision:"verified"|"rejected";amountBaht:string;reference:string}>()
  function review(decision:"verified"|"rejected") {
    const command=(request?.decision===decision ? request : undefined)??{key:crypto.randomUUID(),decision,amountBaht:amount,reference}
    setRequest(command)
    startTransition(async()=>{
      try {
      const result=await reviewPaymentClaim({claimId,invoiceId,...command})
      if(result.error) { toast.error(result.error); return }
      toast.success(decision==="verified"?"ตรวจสอบและตัดยอดแล้ว / Receipt verified":"ปฏิเสธรายการแล้ว / Claim rejected")
      router.refresh()
      } catch { toast.error("Could not confirm the response. Retry unchanged details to recover the original result.") }
    })
  }
  return <div className="space-y-2">
    <Input aria-label="Verified amount (THB)" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value); setRequest(undefined)}} />
    <Input aria-label="Verification evidence reference" placeholder="Bank receipt reference or rejection reason" value={reference} onChange={e=>{setReference(e.target.value); setRequest(undefined)}} maxLength={500} />
    <p className="text-xs text-muted-foreground">ตรวจสอบยอดรับเงินจริงและเลขอ้างอิงก่อนยืนยัน / Match the actual receipt before approval.</p>
    <div className="flex gap-2"><Button disabled={pending||reference.trim().length<3} onClick={()=>review("verified")}>Verify receipt</Button>
    <Button variant="outline" disabled={pending||reference.trim().length<3} onClick={()=>review("rejected")}>Reject claim</Button></div>
  </div>
}
