import Link from "next/link"
import { SearchX } from "lucide-react"

import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

/** Branded 404 for unknown URLs and every `notFound()` record lookup. */
export default function NotFound() {
  return (
    <AuthShell>
      <CardHeader>
        <div className="flex items-center gap-2">
          <SearchX className="erp-auth-icon size-5" aria-hidden />
          <CardTitle className="text-xl">Page not found</CardTitle>
        </div>
        <CardDescription>
          This page doesn&apos;t exist, or the record was removed or belongs to another workspace.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button className="w-full" render={<Link href="/dashboard" />}>
          Back to dashboard
        </Button>
      </CardFooter>
    </AuthShell>
  )
}
