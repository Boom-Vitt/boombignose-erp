"use client"

import { useState, useTransition, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { rejectExpenseClaim } from "../actions"

export function RejectDialog({ claimId, label, variant }: { claimId: string; label: string; variant: "default" | "outline" }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const note = new FormData(event.currentTarget).get("note")
    start(async () => {
      const result = await rejectExpenseClaim(claimId, { note })
      setError(result.error ?? "")
      if (!result.error) setOpen(false)
    })
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size="sm" variant={variant} />}>{label}</DialogTrigger>
    <DialogContent>
      <form onSubmit={submit} className="space-y-4">
        <DialogHeader>
          <DialogTitle>Reject expense claim</DialogTitle>
          <DialogDescription>The claimant sees this reason and can reopen the claim to fix it. Approved costs are removed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2"><Label htmlFor="reject-note">Reason</Label><Textarea id="reject-note" name="note" required maxLength={2000} autoFocus /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending}>{pending ? "Rejecting…" : "Reject claim"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
