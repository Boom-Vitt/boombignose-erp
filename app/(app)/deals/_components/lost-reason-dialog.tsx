"use client"

import { useId, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { useRecordGuard } from "@/components/record/record-guard"

const OFFLINE = "Couldn't reach the server. Please try again."

export type LostReason = { id: string; name: string }

/** Asks why a deal was lost; `onConfirm` marks it lost with the picked reason. */
export function LostReasonDialog({
  open,
  onOpenChange,
  dealTitle,
  reasons,
  canManage,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dealTitle: string
  reasons: LostReason[]
  /** Owners and admins get a link to edit the list. */
  canManage: boolean
  onConfirm: (reasonId: string, note: string) => Promise<{ error?: string }>
}) {
  const id = useId()
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason) {
      setError("Pick a lost reason")
      return
    }
    startTransition(async () => {
      const res = await onConfirm(reason, note.trim()).catch(() => ({ error: OFFLINE }))
      setError(res.error ?? "")
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setError("")
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Mark &ldquo;{dealTitle}&rdquo; as lost</DialogTitle>
            <DialogDescription>Why was it lost? The reason shows on the deal and in reports.</DialogDescription>
          </DialogHeader>
          {reasons.length ? (
            <RadioGroup aria-labelledby={`${id}-label`} value={reason} onValueChange={(v) => setReason(v as string)}>
              <span id={`${id}-label`} className="sr-only">Lost reason</span>
              {reasons.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <RadioGroupItem id={`${id}-${r.id}`} value={r.id} />
                  <Label htmlFor={`${id}-${r.id}`} className="font-normal">{r.name}</Label>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <p className="text-muted-foreground text-sm">
              No lost reasons yet. {canManage ? "Add some first." : "Ask an owner or admin to add some."}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-note`}>Note (optional)</Label>
            <Textarea id={`${id}-note`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </div>
          {canManage ? (
            <Link href="/deals/lost-reasons" className="text-muted-foreground text-sm underline-offset-4 hover:underline">
              Manage lost reasons
            </Link>
          ) : null}
          {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" variant="destructive" disabled={pending || !reasons.length}>
              {pending ? "Saving…" : "Mark lost"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The deal page's "Mark lost" step: a button that opens the reason dialog, locked with the status bar. */
export function MarkLostButton({
  label,
  variant,
  dealTitle,
  reasons,
  canManage,
  onConfirm,
}: {
  label: string
  variant: "default" | "outline"
  dealTitle: string
  reasons: LostReason[]
  canManage: boolean
  onConfirm: (reasonId: string, note: string) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const { busy, run } = useRecordGuard()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} disabled={busy} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <LostReasonDialog
        open={open}
        onOpenChange={setOpen}
        dealTitle={dealTitle}
        reasons={reasons}
        canManage={canManage}
        onConfirm={async (reasonId, note) => {
          // Like the bar's other steps: the dialog closes and the move runs under the record lock.
          setOpen(false)
          run(async () => {
            const res = await onConfirm(reasonId, note).catch(() => ({ error: OFFLINE }))
            if (res.error) {
              toast.error(res.error)
              return
            }
            toast.success("Deal marked lost")
            router.refresh()
          })
          return {}
        }}
      />
    </>
  )
}
