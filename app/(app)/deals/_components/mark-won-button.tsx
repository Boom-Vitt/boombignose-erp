"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function MarkWonButton({ onMarkWon }: { onMarkWon: () => Promise<{ error?: string }> }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await onMarkWon()
          if (res.error) {
            toast.error(res.error)
            return
          }
          toast.success("Deal marked won")
          router.refresh()
        })
      }
    >
      Mark deal won
    </Button>
  )
}
