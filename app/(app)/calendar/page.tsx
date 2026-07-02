import Link from "next/link"
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { currentMonthKey, todayISO } from "@/lib/dates"
import {
  monthMatrix,
  groupByDate,
  monthLabel,
  formatMonthKey,
  parseMonthKey,
  prevMonth,
  nextMonth,
} from "@/lib/calendar/month"
import type { Enums } from "@/lib/types/database"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { CalendarLegend } from "./_components/calendar-legend"
import { DayCell } from "./_components/day-cell"
import type { CalendarItem, CalendarTone } from "./types"

export const dynamic = "force-dynamic"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

const ACTIVITY_META: Record<
  Enums<"activity_type">,
  { label: string; tone: CalendarTone }
> = {
  follow_up: { label: "Follow-up", tone: "amber" },
  meeting: { label: "Meeting", tone: "violet" },
  call: { label: "Call", tone: "blue" },
  email: { label: "Email", tone: "neutral" },
  note: { label: "Note", tone: "neutral" },
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const { month: monthParam } = await searchParams
  const ym =
    parseMonthKey(monthParam) ?? parseMonthKey(currentMonthKey())!

  const grid = monthMatrix(ym.year, ym.month)
  // The grid includes spill-over days from adjacent months; fetch across the
  // whole visible range so those cells are populated too.
  const rangeStart = grid[0][0].iso
  const rangeEnd = grid[5][6].iso

  // Org-scoped fetches for everything dated inside the visible window.
  const [activitiesRes, invoicesRes, projectsRes] = await Promise.all([
    supabase
      .from("activities")
      .select("id, type, due_date, client_id, clients(name)")
      .eq("org_id", ctx.orgId)
      .not("due_date", "is", null)
      .gte("due_date", rangeStart)
      .lte("due_date", rangeEnd),
    supabase
      .from("invoices")
      .select("id, number, due_date")
      .eq("org_id", ctx.orgId)
      .not("due_date", "is", null)
      .gte("due_date", rangeStart)
      .lte("due_date", rangeEnd),
    supabase
      .from("projects")
      .select("id, name, deadline")
      .eq("org_id", ctx.orgId)
      .not("deadline", "is", null)
      .gte("deadline", rangeStart)
      .lte("deadline", rangeEnd),
  ])

  const items: CalendarItem[] = []

  for (const a of activitiesRes.data ?? []) {
    if (!a.due_date) continue
    const meta = ACTIVITY_META[a.type]
    const client = a.clients?.name
    items.push({
      id: `activity-${a.id}`,
      date: a.due_date,
      label: client ? `${meta.label} · ${client}` : meta.label,
      tone: meta.tone,
      href: a.client_id ? `/clients/${a.client_id}` : undefined,
    })
  }

  for (const inv of invoicesRes.data ?? []) {
    if (!inv.due_date) continue
    items.push({
      id: `invoice-${inv.id}`,
      date: inv.due_date,
      label: `Invoice ${inv.number} due`,
      tone: "red",
      href: `/finance/invoices/${inv.id}`,
    })
  }

  for (const p of projectsRes.data ?? []) {
    if (!p.deadline) continue
    items.push({
      id: `project-${p.id}`,
      date: p.deadline,
      label: `${p.name} deadline`,
      tone: "emerald",
      href: `/projects/${p.id}`,
    })
  }

  const byDate = groupByDate(items)

  const prev = prevMonth(ym)
  const next = nextMonth(ym)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Follow-ups, meetings, invoice due dates, and project deadlines."
      >
        <Button
          variant="outline"
          size="icon"
          aria-label={`Previous month (${monthLabel(prev.year, prev.month)})`}
          render={
            <Link href={`/calendar?month=${formatMonthKey(prev.year, prev.month)}`} />
          }
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          render={<Link href={`/calendar?month=${currentMonthKey()}`} />}
        >
          <CalendarDays /> Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Next month (${monthLabel(next.year, next.month)})`}
          render={
            <Link href={`/calendar?month=${formatMonthKey(next.year, next.month)}`} />
          }
        >
          <ChevronRight />
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-medium">
          {monthLabel(ym.year, ym.month)}
        </h2>
        <CalendarLegend />
      </div>

      <Card className="p-0">
        <CardContent className="px-0">
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-muted-foreground border-b px-1.5 py-2 text-center text-xs font-medium"
              >
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
            {grid.flat().map((cell) => (
              <DayCell
                key={cell.iso}
                cell={cell}
                items={byDate[cell.iso] ?? []}
                isToday={cell.iso === today}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
