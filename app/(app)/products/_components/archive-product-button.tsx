"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setProductActive } from "@/lib/products/actions"
import { Button } from "@/components/ui/button"

export function ArchiveProductButton({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return <Button type="button" variant="outline" disabled={pending} onClick={async () => {
    setPending(true)
    try {
      const result = await setProductActive(id, !active)
      if (result.error) { toast.error(result.error); return }
      toast.success(active ? "Product archived" : "Product restored")
      router.refresh()
    } finally { setPending(false) }
  }}>{active ? "Archive" : "Restore"}</Button>
}
