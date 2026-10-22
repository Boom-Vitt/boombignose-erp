"use client"

import { useId, useState, useTransition } from "react"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { satangToBahtString } from "@/lib/money"
import { updateTimeEntry } from "../actions"

export function EditTimeEntryButton({ entry }: { entry: { id: string; minutes: number; rate_satang: number | null; billable: boolean; notes: string | null } }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit time entry"><Pencil /></Button>} />
    <DialogContent>
      <DialogHeader><DialogTitle>Edit time entry</DialogTitle><DialogDescription>Update unbilled time or time on a cancelled invoice.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(async () => {
          const result = await updateTimeEntry({ id: entry.id, minutes: Number(data.get("minutes")), rateBaht: String(data.get("rate")), billable: data.get("billable") === "on", notes: String(data.get("notes")) })
          if (result.error) { toast.error(result.error); return }
          toast.success("Time entry updated")
          setOpen(false)
        })
      }}>
        <div className="space-y-2"><Label htmlFor={`${id}-minutes`}>Minutes</Label><Input id={`${id}-minutes`} name="minutes" type="number" min="0" step="1" required defaultValue={entry.minutes} /></div>
        <div className="space-y-2"><Label htmlFor={`${id}-rate`}>Rate (THB/hour)</Label><Input id={`${id}-rate`} name="rate" inputMode="decimal" defaultValue={entry.rate_satang === null ? "" : satangToBahtString(entry.rate_satang)} /></div>
        <Label><input name="billable" type="checkbox" defaultChecked={entry.billable} /> Billable</Label>
        <div className="space-y-2"><Label htmlFor={`${id}-notes`}>Notes</Label><Textarea id={`${id}-notes`} name="notes" defaultValue={entry.notes ?? ""} maxLength={5000} /></div>
        <Button type="submit" disabled={pending}>Save time</Button>
      </form>
    </DialogContent>
  </Dialog>
}
