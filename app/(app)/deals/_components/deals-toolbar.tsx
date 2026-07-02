"use client"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"
import { Download, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import {
  configToHref,
  configToQueryString,
  type ViewConfig,
} from "@/app/(app)/views/view-config"
import { SaveViewButton } from "@/app/(app)/views/save-view-button"
import {
  SavedViewsMenu,
  type SavedView,
} from "@/app/(app)/views/saved-views-menu"

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All stages" },
  { value: "lead", label: "Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "discovery", label: "Discovery" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
]

/**
 * URL-driven filter bar for the Deals board. Stage + title search write to the
 * query string (shareable, server-readable). Export links carry the same
 * filters so the CSV matches what's on screen.
 */
export function DealsToolbar({
  stage,
  q,
  savedViews,
}: {
  stage: string
  q: string
  savedViews: SavedView[]
}) {
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

  const config: ViewConfig = {
    ...(stage ? { stage } : {}),
    ...(q ? { q } : {}),
  }

  function navigate(next: ViewConfig) {
    router.push(configToHref(pathname, next))
  }

  function onStageChange(value: string) {
    navigate({ ...config, stage: value === "all" ? undefined : value })
  }

  function submitSearch() {
    navigate({ ...config, q: search })
  }

  const exportQs = configToQueryString(config)
  const exportHref = exportQs ? `/deals/export?${exportQs}` : "/deals/export"
  const hasFilters = Boolean(stage || q)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={STAGE_OPTIONS}
        value={stage || "all"}
        onValueChange={(v) => onStageChange(String(v))}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STAGE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative w-full sm:w-56">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          value={search}
          placeholder="Search deals…"
          className="h-7 pl-8 text-sm"
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

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={pathname} />}
        >
          <X />
          Clear
        </Button>
      ) : null}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        <SavedViewsMenu
          views={savedViews}
          basePath={pathname}
          activeConfig={config}
        />
        <SaveViewButton module="deals" config={config} />
        <Button variant="outline" size="sm" render={<Link href={exportHref} />}>
          <Download />
          Export CSV
        </Button>
      </div>
    </div>
  )
}
