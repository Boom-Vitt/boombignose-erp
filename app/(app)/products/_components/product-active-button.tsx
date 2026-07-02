"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Power, PowerOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { setProductActive } from "../actions"

export function ProductActiveButton({
  id,
  active,
}: {
  id: string
  active: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setProductActive({ id, active: !active })
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success(active ? "Item deactivated" : "Item reactivated")
        })
      }
    >
      {active ? <PowerOff /> : <Power />}
      {active ? "Deactivate" : "Reactivate"}
    </Button>
  )
}
