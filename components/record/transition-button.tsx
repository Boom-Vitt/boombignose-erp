"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function TransitionButton<S extends string>({
  label,
  to,
  transition,
  variant,
}: {
  label: string
  to: S
  transition: (to: S) => Promise<{ error?: string }>
  variant: "default" | "outline"
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await transition(to)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Status updated")
          router.refresh()
        })
      }
    >
      {label}
    </Button>
  )
}
