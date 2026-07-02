import { Bell, Workflow, Clock, CheckCircle2, AlertTriangle } from "lucide-react"
import { formatInTimeZone } from "date-fns-tz"

import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { APP_TZ, todayISO, isPastDue } from "@/lib/dates"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Enums } from "@/lib/types/database"

export const dynamic = "force-dynamic"

const EVENT_LIMIT = 25

function formatDueDate(dueISO: string): string {
  // dueISO is a plain 'YYYY-MM-DD'; render without timezone shifting.
  return formatInTimeZone(`${dueISO}T00:00:00Z`, "UTC", "d MMM yyyy")
}

function formatTimestamp(iso: string): string {
  return formatInTimeZone(iso, APP_TZ, "d MMM, HH:mm")
}

function EventStatusBadge({ status }: { status: Enums<"outbound_status"> }) {
  const map: Record<Enums<"outbound_status">, { label: string; className: string }> = {
    queued: {
      label: "Queued",
      className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
    },
    delivered: {
      label: "Delivered",
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    },
    failed: {
      label: "Failed",
      className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    },
  }
  const { label, className } = map[status]
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", className)}>
      {label}
    </Badge>
  )
}

export default async function AutomationPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const [{ data: reminders }, { data: events }] = await Promise.all([
    supabase
      .from("reminders")
      .select("id, entity, title, due_date, status")
      .eq("org_id", ctx.orgId)
      .eq("status", "pending")
      .order("due_date", { ascending: true }),
    supabase
      .from("outbound_events")
      .select("id, event_type, status, created_at")
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT),
  ])

  const pendingReminders = reminders ?? []
  const recentEvents = events ?? []
  const bothEmpty = pendingReminders.length === 0 && recentEvents.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation"
        description="Follow-up reminders the cron scan raised, and the outbound events queued for n8n / Hermes."
      />

      {bothEmpty ? (
        <EmptyState
          icon={Workflow}
          title="No automation activity yet"
          description="When a deal or activity follow-up comes due, the cron scan creates a reminder here and queues an outbound event for n8n. Trigger POST /api/cron/followups to populate it."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending reminders</CardTitle>
              <CardDescription>
                Due or overdue follow-ups awaiting a send. Soonest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingReminders.length === 0 ? (
                <EmptyState
                  icon={Bell}
                  title="No pending reminders"
                  description="Everything is followed up. New ones appear after the next scan."
                  className="border-0 p-6"
                />
              ) : (
                <ul className="divide-y">
                  {pendingReminders.map((reminder) => {
                    const overdue = isPastDue(reminder.due_date, today)
                    return (
                      <li
                        key={reminder.id}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="truncate text-sm font-medium">
                            {reminder.title}
                          </p>
                          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <Clock className="size-3" aria-hidden />
                            {formatDueDate(reminder.due_date)}
                            <Badge
                              variant="outline"
                              className="ml-1 capitalize"
                            >
                              {reminder.entity}
                            </Badge>
                          </p>
                        </div>
                        {overdue ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-transparent bg-red-100 font-medium text-red-800 dark:bg-red-950 dark:text-red-300"
                          >
                            <AlertTriangle className="mr-1 size-3" aria-hidden />
                            Overdue
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-transparent bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                          >
                            Due today
                          </Badge>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outbound events</CardTitle>
              <CardDescription>
                The queue n8n / Hermes consumes. Most recent first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentEvents.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="No outbound events"
                  description="Events are queued here when reminders are created."
                  className="border-0 p-6"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Queued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="font-mono text-xs">
                          {event.event_type}
                        </TableCell>
                        <TableCell>
                          <EventStatusBadge status={event.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs">
                          {formatTimestamp(event.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
