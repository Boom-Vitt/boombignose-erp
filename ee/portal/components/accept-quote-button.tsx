"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { portalAcceptQuote } from "@/ee/portal/actions"

export function AcceptQuoteButton({
  token,
  quoteId,
}: {
  token: string
  quoteId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><Check /> Accept</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Accept quote</DialogTitle>
          <DialogDescription>Your name and email will be recorded with this acceptance.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          startTransition(async () => {
            const res = await portalAcceptQuote({ token, quoteId, name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") })
            if (res?.error) { toast.error(res.error); return }
            toast.success("Quote accepted")
            setOpen(false)
            router.refresh()
          })
        }}>
          <div className="space-y-2">
            <Label htmlFor={`accept-name-${quoteId}`}>Your name</Label>
            <Input id={`accept-name-${quoteId}`} name="name" autoComplete="name" required maxLength={200} disabled={pending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`accept-email-${quoteId}`}>Your email</Label>
            <Input id={`accept-email-${quoteId}`} name="email" type="email" autoComplete="email" required maxLength={320} disabled={pending} />
          </div>
          <Button type="submit" disabled={pending}><Check /> Accept quote</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
