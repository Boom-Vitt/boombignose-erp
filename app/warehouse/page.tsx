"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/** Legacy /warehouse → shell 3D mode (toggle on the ERP chrome). */
export default function WarehouseRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    try {
      localStorage.setItem("bignose-view-mode", "3d")
    } catch {
      /* ignore */
    }
    router.replace("/dashboard")
  }, [router])
  return (
    <div className="bg-background text-muted-foreground flex min-h-svh items-center justify-center text-sm">
      Opening Campus 3D…
    </div>
  )
}
