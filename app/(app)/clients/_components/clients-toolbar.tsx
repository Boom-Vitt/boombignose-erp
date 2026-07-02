"use client"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"
import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { configToHref, type ViewConfig } from "@/app/(app)/views/view-config"

/**
 * URL-driven text search for the Clients list. Writes `?q=` so the filter is
 * shareable and read server-side.
 */
export function ClientsToolbar({ q }: { q: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(q)
  // Re-sync the input when the URL's `q` changes (e.g. loading a saved view),
  // adjusting state during render per React's guidance — no effect needed.
  const [prevQ, setPrevQ] = useState(q)
  if (q !== prevQ) {
    setPrevQ(q)
    setSearch(q)
  }

  function submitSearch() {
    const next: ViewConfig = search.trim() ? { q: search.trim() } : {}
    router.push(configToHref(pathname, next))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          value={search}
          placeholder="Search clients…"
          className="h-8 pl-8"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submitSearch()
            }
          }}
          onBlur={submitSearch}
        />
      </div>
      {q ? (
        <Button variant="ghost" size="sm" render={<Link href={pathname} />}>
          <X />
          Clear
        </Button>
      ) : null}
    </div>
  )
}
