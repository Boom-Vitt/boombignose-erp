import type { ReactNode } from "react"

import { Card } from "@/components/ui/card"

/** Centered 3D stage and accent card shared by every sign-in screen. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="erp-auth-stage">
      <Card className="erp-auth-card">{children}</Card>
    </main>
  )
}
