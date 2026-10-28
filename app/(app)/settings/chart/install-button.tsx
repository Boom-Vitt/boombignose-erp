"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { installThaiSmeChart } from "./actions"

export function InstallChartButton() {
  const [pending, start] = useTransition()
  const router = useRouter()
  return <Button type="button" disabled={pending} onClick={() => start(async () => {
    const result = await installThaiSmeChart()
    if (result.error) { toast.error(result.error); return }
    toast.success("Missing Thai SME accounts were added. Existing codes were left as they are.")
    router.refresh()
  })}>{pending ? "Adding…" : "Add Thai SME accounts"}</Button>
}
