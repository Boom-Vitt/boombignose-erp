"use client"

import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

/** Branded fallback for an unexpected render error; the digest lets support find the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthShell>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TriangleAlert className="erp-auth-icon size-5" aria-hidden />
          <CardTitle className="text-xl">Something went wrong</CardTitle>
        </div>
        <CardDescription>
          This page could not load. Try again, or go back to the dashboard.
          {error.digest ? <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-col gap-3">
        <Button className="w-full" onClick={reset}>
          Try again
        </Button>
        <Button variant="outline" className="w-full" render={<Link href="/dashboard" />}>
          Back to dashboard
        </Button>
      </CardFooter>
    </AuthShell>
  )
}
