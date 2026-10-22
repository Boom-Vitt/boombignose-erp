"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SaveViewButton } from "@/app/(app)/views/save-view-button"
import { SavedViewsMenu, type SavedView } from "@/app/(app)/views/saved-views-menu"
import {
  FACET_LISTS,
  facetLabel,
  serializeFacets,
  type FacetConfig,
  type FacetList,
} from "@/lib/search-facets"
import { PERIODS } from "@/lib/periods"

export function SearchFacets({ list, config, savedViews, params = {} }: {
  list: FacetList
  config: FacetConfig
  savedViews: SavedView[]
  /** Non-facet query params kept on every facet link and search, such as the active view. */
  params?: Record<string, string>
}) {
  const pathname = usePathname()
  const definition = FACET_LISTS[list]

  function href(key: keyof FacetConfig, value?: string) {
    const next = { ...config, [key]: config[key] === value ? undefined : value }
    const qs = [serializeFacets(next, list), new URLSearchParams(params).toString()].filter(Boolean).join("&")
    return qs ? `${pathname}?${qs}` : pathname
  }

  const filters = [
    { key: "mine" as const, value: "1", label: "My records" },
    ...definition.statuses.map((value) => ({ key: "status" as const, value, label: facetLabel(value) })),
    ...Object.entries(PERIODS).map(([value, label]) => ({ key: "period" as const, value, label })),
  ]
  const chips = [
    ...(config.q ? [{ key: "q" as const, label: `Search: ${config.q}` }] : []),
    ...filters.filter(({ key, value }) => config[key] === value),
    ...(config.groupBy ? [{ key: "groupBy" as const, label: `Group by: ${facetLabel(config.groupBy)}` }] : []),
  ]

  return (
    <section aria-label="Search and facets" className="space-y-3 rounded-xl border p-3">
      <form action={pathname} className="flex flex-wrap gap-2">
        {Object.entries({ ...config, ...params }).filter(([key]) => key !== "q").map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <Input
          key={config.q ?? ""}
          name="q"
          aria-label={`Search ${list}`}
          placeholder={`Search ${list}…`}
          defaultValue={config.q ?? ""}
          className="w-full sm:w-72"
        />
        <Button type="submit" variant="outline">Search</Button>
        {chips.map(({ key, label }) => (
          <Button
            key={key}
            variant="secondary"
            render={<Link href={href(key)} />}
            aria-label={`Remove ${label}`}
            data-testid="facet-chip"
          >
            {label}<X />
          </Button>
        ))}
      </form>
      <details>
        <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
          Filters, group by and saved views
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <h3 className="mb-2 text-sm font-semibold">Filters</h3>
            {list === "finance" && <p className="text-xs text-muted-foreground">My records uses the client owner.</p>}
            {list === "deals" && <p className="text-xs text-muted-foreground">Period uses the expected close date.</p>}
            {list === "projects" && <p className="text-xs text-muted-foreground">Period uses the deadline.</p>}
            {filters.map(({ key, value, label }) => (
              <Button
                key={`${key}-${value}`}
                size="sm"
                variant={config[key] === value ? "secondary" : "ghost"}
                className="flex"
                render={<Link href={href(key, value)} />}
                aria-current={config[key] === value ? "true" : undefined}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <h3 className="mb-2 text-sm font-semibold">Group by</h3>
            {definition.groups.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={config.groupBy === value ? "secondary" : "ghost"}
                className="flex"
                render={<Link href={href("groupBy", value)} />}
                aria-current={config.groupBy === value ? "true" : undefined}
              >
                {facetLabel(value)}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Saved</h3>
            <SavedViewsMenu views={savedViews} basePath={pathname} activeConfig={config} params={params} />
            <SaveViewButton module={list} config={config} />
            {savedViews.length === 0 && (
              <p className="text-xs text-muted-foreground">Save the current search, filters and grouping for later.</p>
            )}
          </div>
        </div>
      </details>
    </section>
  )
}
