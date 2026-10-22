import Link from "next/link"
import { Briefcase, Plus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import type { KanbanCard, KanbanColumn } from "@/lib/kanban"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { ProjectStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { matchesFacets, parseFacets, serializeFacets, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { fetchAllRows } from "@/lib/queries/fetch-all-rows"
import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { deadlineMeta } from "./_lib/dates"
import { profileNames } from "./_lib/profile-names"
import { ProjectsBoard } from "./_components/projects-board"
import { ViewSwitch } from "./_components/view-switch"

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

const statusIndex = (status: ProjectStatus) => STATUS_ORDER.findIndex((s) => s.value === status)

// Finished work has no upcoming deadline to flag.
const CLOSED: ProjectStatus[] = ["delivered", "cancelled"]

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const params = await searchParams
  const config = parseFacets(params, "projects")
  const view = params.view === "board" ? "board" : "list"
  const facetQuery = serializeFacets(config, "projects")

  const [projects, savedViews] = await Promise.all([
    fetchAllRows(() => supabase
      .from("projects")
      .select("id, name, status, deadline, owner, client_id, budget_satang, client:clients(name)")
      .eq("org_id", ctx.orgId)
      .order("deadline", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id")),
    getFacetSavedViews("projects"),
  ])

  const allRows = projects as Array<{
    id: string
    name: string
    status: ProjectStatus
    deadline: string | null
    owner: string | null
    client_id: string | null
    budget_satang: number | null
    client: { name: string } | null
  }>
  const ownerNames = await profileNames(supabase, allRows.map((p) => p.owner))
  const ownerLabel = (owner: string | null) => (owner && ownerNames.get(owner)) || null

  const now = new Date()
  const rows = allRows.filter((p) => matchesFacets(config, {
    text: `${p.name} ${p.client?.name ?? ""}`, status: p.status, date: p.deadline, owner: p.owner,
  }, ctx.userId, now))

  const groups: Record<string, (p: (typeof rows)[number]) => { key: string; label: string }> = {
    status: (p) => ({ key: p.status, label: STATUS_ORDER.find((s) => s.value === p.status)?.label ?? p.status }),
    client: (p) => ({ key: p.client_id ?? "", label: p.client?.name ?? "No client" }),
    owner: (p) => ({ key: p.owner ?? "", label: ownerLabel(p.owner) ?? "Unassigned" }),
    month: (p) => ({ key: p.deadline?.slice(0, 7) ?? "", label: p.deadline?.slice(0, 7) ?? "No deadline" }),
  }
  const group = config.groupBy ? groups[config.groupBy] : undefined
  const listRows = config.groupBy === "status"
    ? [...rows].sort((a, b) => statusIndex(a.status) - statusIndex(b.status))
    : rows

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
    owner: ownerLabel(p.owner),
    due: CLOSED.includes(p.status) ? null : p.deadline,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Delivery work across every client."
      >
        <ViewSwitch path="/projects" query={facetQuery} view={view} defaultView="list" />
        {newButton}
      </PageHeader>

      {allRows.length === 0 ? null : (
        <SearchFacets
          list="projects"
          config={config}
          savedViews={savedViews}
          params={view === "board" ? { view } : undefined}
        />
      )}

      {allRows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No projects yet"
          description="Create your first project to start tracking delivery, tasks, and milestones."
          action={newButton}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No matching projects"
          description="No projects match the current filters. Try clearing the search or filters."
        />
      ) : view === "board" ? (
        <ProjectsBoard
          columns={config.status ? BOARD_COLUMNS.filter((col) => col.id === config.status) : BOARD_COLUMNS}
          moveTargets={BOARD_COLUMNS}
          cards={cards}
          today={todayISO()}
          storageKey={`kanban:projects:${ctx.userId}`}
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GroupedTableRows rows={listRows} colSpan={5} group={group}>
                  {(p) => {
                    const dl = deadlineMeta(p.deadline)
                    return (
                      <TableRow key={p.id}>
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
                          <ProjectStatusBadge status={p.status} />
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
                          {ownerLabel(p.owner) ?? "—"}
                        </TableCell>
                      </TableRow>
                    )
                  }}
                </GroupedTableRows>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
