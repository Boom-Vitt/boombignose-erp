import Link from "next/link"
import { Columns3, List } from "lucide-react"

import { Button } from "@/components/ui/button"

export type ListView = "list" | "board"

const VIEWS = [
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: Columns3 },
] as const

/** List/board toggle that keeps the active facets (`query`) on both links. */
export function ViewSwitch({ path, query, view, defaultView }: {
  path: string
  query: string
  view: ListView
  defaultView: ListView
}) {
  return (
    <div role="group" aria-label="View" className="flex rounded-lg border p-0.5">
      {VIEWS.map(({ value, label, icon: Icon }) => {
        const qs = [query, value === defaultView ? "" : `view=${value}`].filter(Boolean).join("&")
        return (
          <Button
            key={value}
            size="sm"
            variant={view === value ? "secondary" : "ghost"}
            aria-current={view === value ? "page" : undefined}
            render={<Link href={qs ? `${path}?${qs}` : path} />}
          >
            <Icon data-icon="inline-start" /> {label}
          </Button>
        )
      })}
    </div>
  )
}
