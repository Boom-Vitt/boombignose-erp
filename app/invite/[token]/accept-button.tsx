"use client"

import { useTransition } from "react"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { acceptInvitation } from "@/app/(app)/settings/org-actions"
import { Button } from "@/components/ui/button"

/** Accepts the invitation; on success the action redirects to the dashboard. */
export function AcceptInvitationButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await acceptInvitation({ token })
          if (res?.error) toast.error(res.error)
        })
      }
    >
      <Check /> Accept invitation
    </Button>
  )
}
