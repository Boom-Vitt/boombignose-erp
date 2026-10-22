import Link from "next/link"
import type { LucideIcon } from "lucide-react"

export type SmartButton = {
  label: string
  icon: LucideIcon
  href: string
  /** Number of linked records; 0 hides the button unless it is the next step. */
  count: number
  /** Shown instead of the count, e.g. a money or hours total. */
  value?: string
  nextStep?: boolean
}

/** A `count: "exact"` read: the true total, even past the API row cap, and at least its first row. */
type Linked = { count: number | null; data: { id: string }[] | null }

/** One linked record opens it; several open the place that lists them. */
export function recordHref({ count, data }: Linked, one: (id: string) => string, many: string) {
  return count === 1 && data?.[0] ? one(data[0].id) : many
}

export function SmartButtons({ buttons }: { buttons: SmartButton[] }) {
  const visible = buttons.filter((b) => b.count > 0 || b.nextStep)
  if (!visible.length) return null
  return (
    <nav aria-label="Related records">
      <ul className="flex flex-wrap gap-2">
        {visible.map(({ label, icon: Icon, href, count, value }) => (
          <li key={label}>
            <Link
              href={href}
              className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
            >
              <Icon className="text-muted-foreground size-4" aria-hidden />
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold tabular-nums">{value ?? count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
