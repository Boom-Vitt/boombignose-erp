"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { deleteContact } from "../actions"

export function DeleteContactButton({
  contactId,
  clientId,
}: {
  contactId: string
  clientId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Remove contact"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await deleteContact(contactId, clientId)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success("Contact removed")
          router.refresh()
        })
      }
    >
      <Trash2 className="text-muted-foreground" />
    </Button>
  )
}
