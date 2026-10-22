import Link from "next/link"
import { Plus, Target } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { formatTHBWhole } from "@/lib/money"
import { earliestDate, type KanbanCard, type KanbanColumn } from "@/lib/kanban"
import {
  pipelineValue,
  weightedPipelineValue,
  type DealStage,
} from "@/lib/metrics/pipeline"
import { Constants } from "@/lib/types/database"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { profileNames } from "@/app/(app)/projects/_lib/profile-names"

import { DealsBoard } from "./_components/deals-board"
import { DealsToolbar } from "./_components/deals-toolbar"
import type { SavedView } from "@/app/(app)/views/saved-views-menu"
import type { ViewConfig } from "@/app/(app)/views/view-config"

export const dynamic = "force-dynamic"

const COLUMNS: KanbanColumn<DealStage>[] = [
  { id: "lead", label: "Lead" },
  { id: "contacted", label: "Contacted" },
  { id: "discovery", label: "Discovery" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won", foldedByDefault: true },
  { id: "lost", label: "Lost", foldedByDefault: true },
]

const DEAL_STAGES = Constants.public.Enums.deal_stage

/** Pull the known filter keys out of a saved-view config row. */
function toViewConfig(config: unknown): ViewConfig {
  const c = (config ?? {}) as Record<string, unknown>
  const out: ViewConfig = {}
  if (typeof c.stage === "string") out.stage = c.stage
  if (typeof c.q === "string") out.q = c.q
  return out
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const { stage: stageParam, q: qParam } = await searchParams
  const stage = (DEAL_STAGES as readonly string[]).includes(stageParam ?? "")
    ? (stageParam as DealStage)
    : ""
  const q = (qParam ?? "").trim()

  const [dealsRes, clientsRes, viewsRes, activitiesRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id,title,stage,value_satang,client_id,owner,next_follow_up_date,created_at"
      )
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id,name").eq("org_id", ctx.orgId),
    supabase
      .from("saved_views")
      .select("id, name, config")
      .eq("org_id", ctx.orgId)
      .eq("module", "deals")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("activities")
      .select("deal_id,due_date")
      .eq("org_id", ctx.orgId)
      .eq("done", false),
  ])

  const allDeals = dealsRes.data ?? []
  const clients = clientsRes.data ?? []
  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const ownerName = await profileNames(supabase, allDeals.map((d) => d.owner))
  const nextActivity = new Map<string, string | null>()
  for (const a of activitiesRes.data ?? []) {
    if (a.deal_id) nextActivity.set(a.deal_id, earliestDate([nextActivity.get(a.deal_id) ?? null, a.due_date]))
  }

  const savedViews: SavedView[] = (viewsRes.data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    config: toViewConfig(v.config),
  }))

  // Apply filters in-memory.
  const qLower = q.toLowerCase()
  const deals = allDeals.filter((d) => {
    if (stage && d.stage !== stage) return false
    if (qLower && !d.title.toLowerCase().includes(qLower)) return false
    return true
  })

  // When a stage is selected, only show that column.
  const visibleColumns = stage
    ? COLUMNS.filter((col) => col.id === stage)
    : COLUMNS

  // Headline KPIs summarize the whole pipeline, independent of the active filter.
  const openValue = pipelineValue(allDeals)
  const weighted = weightedPipelineValue(allDeals)

  const cards: KanbanCard<DealStage>[] = deals.map((d) => ({
    id: d.id,
    stage: d.stage,
    title: d.title,
    href: `/deals/${d.id}`,
    amountSatang: d.value_satang,
    client: clientName.get(d.client_id) ?? null,
    owner: (d.owner && ownerName.get(d.owner)) || null,
    due: earliestDate([d.next_follow_up_date, nextActivity.get(d.id) ?? null]),
  }))

  return (
    <div className="space-y-6">
      <PageHeader title="Deals" description="Your sales pipeline and follow-ups.">
        <Button render={<Link href="/deals/new" />}>
          <Plus className="size-4" />
          New deal
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 sm:max-w-lg">
        <StatCard
          label="Open pipeline"
          value={formatTHBWhole(openValue)}
          icon={Target}
          hint="Value of deals still in play"
        />
        <StatCard
          label="Weighted pipeline"
          value={formatTHBWhole(weighted)}
          icon={Target}
          hint="By stage win-probability"
        />
      </div>

      {allDeals.length === 0 ? null : (
        <DealsToolbar stage={stage} q={q} savedViews={savedViews} />
      )}

      {allDeals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No deals yet"
          description="Create your first deal to start tracking your pipeline."
          action={
            <Button render={<Link href="/deals/new" />}>
              <Plus className="size-4" />
              New deal
            </Button>
          }
        />
      ) : deals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No matching deals"
          description="No deals match the current filters. Try clearing the search or stage filter."
        />
      ) : (
        <DealsBoard
          columns={visibleColumns}
          moveTargets={COLUMNS}
          cards={cards}
          clients={clients}
          today={today}
          storageKey={`kanban:deals:${ctx.userId}`}
        />
      )}
    </div>
  )
}

