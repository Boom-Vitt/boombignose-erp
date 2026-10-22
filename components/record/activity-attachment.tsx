"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { recordAttachmentUrl } from "@/lib/record-history/actions"

export function ActivityAttachment({ id, filename }: { id: string; filename: string }) {
  const [pending, startTransition] = useTransition()
  return <Button variant="link" className="h-auto max-w-full justify-start p-0 whitespace-normal break-all text-left" disabled={pending} onClick={() => startTransition(async () => {
    try {
      const result = await recordAttachmentUrl(id)
      if (result.url) window.location.assign(result.url)
      else toast.error(result.error ?? "Unable to download the attachment.")
    } catch { toast.error("Unable to download the attachment.") }
  })}>Download {filename}</Button>
}
