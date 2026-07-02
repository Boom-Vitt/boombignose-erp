"use client"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { Download, X } from "lucide-react"

import { Button } from "@/components/ui/button"
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

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
]

/**
 * Finance filter + export bar. Status filters the invoices table via the URL;
 * the two export buttons download invoices (carrying the status filter) and
 * costs as CSV.
 */
export function FinanceToolbar({
  status,
  savedViews,
}: {
  status: string
  savedViews: SavedView[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  const config: ViewConfig = status ? { status } : {}

  function onStatusChange(value: string) {
    const next: ViewConfig = value === "all" ? {} : { status: value }
    router.push(configToHref(pathname, next))
  }

  const invoicesQs = configToQueryString(config)
  const invoicesExportHref = invoicesQs
    ? `/finance/invoices/export?${invoicesQs}`
    : "/finance/invoices/export"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={STATUS_OPTIONS}
        value={status || "all"}
        onValueChange={(v) => onStatusChange(String(v))}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {status ? (
        <Button variant="ghost" size="sm" render={<Link href={pathname} />}>
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
        <SaveViewButton module="finance" config={config} />
        <Button
          variant="outline"
          size="sm"
          render={<Link href={invoicesExportHref} />}
        >
          <Download />
          Export invoices CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/finance/costs/export" />}
        >
          <Download />
          Export costs CSV
        </Button>
      </div>
    </div>
  )
}
