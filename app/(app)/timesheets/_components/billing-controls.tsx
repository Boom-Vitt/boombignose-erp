"use client"

import { useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { satangToBahtString } from "@/lib/money"
import { billTime, setMemberCostRate } from "../actions"
import type { Option } from "./form-fields"

export function BillTimeForm({ projects }: { projects: Option[] }) {
  const id = useId()
  const router = useRouter()
  const [project, setProject] = useState(projects[0]?.value ?? "")
  const key = useRef<string | null>(null)
  const [pending, startTransition] = useTransition()
  return <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault()
    key.current ??= crypto.randomUUID()
    startTransition(async () => {
      const result = await billTime({ project_id: project, key: key.current! })
      if (result.error) { toast.error(result.error); return }
      toast.success("Draft invoice created from unbilled time")
      router.push(`/finance/invoices/${result.invoiceId}`)
    })
  }}>
    <div className="space-y-2">
      <Label htmlFor={id}>Project to bill</Label>
      <Select value={project} onValueChange={value => { setProject(value ?? ""); key.current = null }}>
        <SelectTrigger id={id} className="min-w-56"><SelectValue /></SelectTrigger>
        <SelectContent>{projects.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <Button disabled={pending || !project}>Bill time</Button>
    <p className="text-muted-foreground basis-full text-xs">Adds unbilled time with an hourly rate to a new draft. Review tax rates before issuing.</p>
  </form>
}

export function MemberCostRateForm({ members }: { members: (Option & { rate: number })[] }) {
  const id = useId()
  const router = useRouter()
  const [member, setMember] = useState(members[0]?.value ?? "")
  const [pending, startTransition] = useTransition()
  return <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await setMemberCostRate({ user_id: member, rateBaht: String(data.get("rate")) })
      if (result.error) { toast.error(result.error); return }
      toast.success("Hourly cost rate updated")
      router.refresh()
    })
  }}>
    <div className="space-y-2">
      <Label htmlFor={`${id}-member`}>Member</Label>
      <Select value={member} onValueChange={value => setMember(value ?? "")}>
        <SelectTrigger id={`${id}-member`} className="min-w-56"><SelectValue /></SelectTrigger>
        <SelectContent>{members.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-rate`}>Labour cost (THB/hour)</Label>
      <Input key={`${member}-${members.find(m => m.value === member)?.rate}`} id={`${id}-rate`} name="rate" inputMode="decimal" required defaultValue={satangToBahtString(members.find(m => m.value === member)?.rate ?? 0)} />
    </div>
    <Button variant="outline" disabled={pending || !member}>Save cost rate</Button>
    <p className="text-muted-foreground basis-full text-xs">Project profit applies the current member rate to all logged time, including non-billable time.</p>
  </form>
}
