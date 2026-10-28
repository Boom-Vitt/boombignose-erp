"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addBankLine, matchBankLine } from "./actions"

export function AddBankLineForm({ today }: { today: string }) {
  const [bookedOn, setBookedOn] = useState(today)
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [pending, start] = useTransition()
  const router = useRouter()
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault()
    start(async () => {
      const result = await addBankLine({ bookedOn, amount, reference })
      if (result.error) { toast.error(result.error); return }
      toast.success("Bank line saved. It is not a receipt until you match it.")
      setAmount(""); setReference(""); router.refresh()
    })
  }}>
    <label className="block text-sm">Date<Input type="date" required value={bookedOn} disabled={pending} onChange={event => setBookedOn(event.target.value)} /></label>
    <label className="block text-sm">Amount (THB, negative for money out)<Input required inputMode="decimal" value={amount} disabled={pending} onChange={event => setAmount(event.target.value)} /></label>
    <label className="block text-sm">Reference<Input required maxLength={200} value={reference} disabled={pending} onChange={event => setReference(event.target.value)} /></label>
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add bank line"}</Button>
  </form>
}

export function MatchBankLineButton({ lineId, paymentId }: { lineId: string; paymentId: string }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return <Button type="button" disabled={pending} onClick={() => start(async () => {
    const result = await matchBankLine({ lineId, paymentId })
    if (result.error) { toast.error(result.error); return }
    toast.success("Bank line matched to that receipt. The receipt itself was not changed.")
    router.refresh()
  })}>{pending ? "Matching…" : "Match this receipt"}</Button>
}
