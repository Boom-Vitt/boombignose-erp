import Link from "next/link"
import { Briefcase, Columns3, List, Plus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import type { KanbanCard, KanbanColumn } from "@/lib/kanban"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { ProjectStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Enums } from "@/lib/types/database"
import { deadlineMeta } from "./_lib/dates"
import { profileNames } from "./_lib/profile-names"
import { ProjectsBoard } from "./_components/projects-board"

export const dynamic = "force-dynamic"

type ProjectStatus = Enums<"project_status">

// Order used to group the board; mirrors the lifecycle.
const STATUS_ORDER: { value: ProjectStatus; label: string }[] = [
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "not_started", label: "Not started" },
  { value: "support", label: "Support" },
  { value: "paused", label: "Paused" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
]

const BOARD_COLUMNS: KanbanColumn<ProjectStatus>[] = STATUS_ORDER.map((s) => ({
  id: s.value,
  label: s.label,
  foldedByDefault: s.value === "cancelled",
}))

// Finished work has no upcoming deadline to flag.
const CLOSED: ProjectStatus[] = ["delivered", "cancelled"]

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const view = (await searchParams).view === "board" ? "board" : "list"

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, deadline, owner, budget_satang, client:clients(name)")
    .eq("org_id", ctx.orgId)
    .order("deadline", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })

  const rows = (projects ?? []) as Array<{
    id: string
    name: string
    status: ProjectStatus
    deadline: string | null
    owner: string | null
    budget_satang: number | null
    client: { name: string } | null
  }>
  const ownerNames = await profileNames(supabase, rows.map((p) => p.owner))

  const newButton = (
    <Button render={<Link href="/projects/new" />}>
      <Plus data-icon="inline-start" /> New project
    </Button>
  )

  const cards: KanbanCard<ProjectStatus>[] = rows.map((p) => ({
    id: p.id,
    stage: p.status,
    title: p.name,
    href: `/projects/${p.id}`,
    amountSatang: p.budget_satang ?? null,
    client: p.client?.name ?? null,
    owner: (p.owner && ownerNames.get(p.owner)) || null,
    due: CLOSED.includes(p.status) ? null : p.deadline,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Delivery work across every client, grouped by status."
      >
        <div role="group" aria-label="View" className="flex rounded-lg border p-0.5">
          <Button
            size="sm"
            variant={view === "list" ? "secondary" : "ghost"}
            aria-current={view === "list" ? "page" : undefined}
            render={<Link href="/projects" />}
          >
            <List data-icon="inline-start" /> List
          </Button>
          <Button
            size="sm"
            variant={view === "board" ? "secondary" : "ghost"}
            aria-current={view === "board" ? "page" : undefined}
            render={<Link href="/projects?view=board" />}
          >
            <Columns3 data-icon="inline-start" /> Board
          </Button>
        </div>
        {newButton}
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No projects yet"
          description="Create your first project to start tracking delivery, tasks, and milestones."
          action={newButton}
        />
      ) : view === "board" ? (
        <ProjectsBoard
          columns={BOARD_COLUMNS}
          cards={cards}
          today={todayISO()}
          storageKey={`kanban:projects:${ctx.userId}`}
        />
      ) : (
        <div className="space-y-5">
          {STATUS_ORDER.map((group) => {
            const groupRows = rows.filter((p) => p.status === group.value)
            if (groupRows.length === 0) return null
            return (
              <Card key={group.value}>
                <CardHeader className="flex-row items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ProjectStatusBadge status={group.value} />
                    <span className="text-muted-foreground text-sm font-normal">
                      {groupRows.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Deadline</TableHead>
                        <TableHead>Owner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupRows.map((p) => {
                        const dl = deadlineMeta(p.deadline)
                        return (
                          <TableRow key={p.id} className="cursor-pointer">
                            <TableCell className="font-medium">
                              <Link
                                href={`/projects/${p.id}`}
                                className="hover:underline"
                              >
                                {p.name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.client?.name ?? "—"}
                            </TableCell>
                            <TableCell>
                              {dl ? (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5",
                                    dl.tone === "danger" &&
                                      "text-red-600 dark:text-red-400",
                                    dl.tone === "warning" &&
                                      "text-amber-600 dark:text-amber-400"
                                  )}
                                >
                                  {dl.label}
                                  {dl.note ? (
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "text-xs",
                                        dl.tone === "danger" &&
                                          "border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
                                        dl.tone === "warning" &&
                                          "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                                      )}
                                    >
                                      {dl.note}
                                    </Badge>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {(p.owner && ownerNames.get(p.owner)) || "—"}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
