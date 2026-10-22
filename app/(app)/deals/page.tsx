import Link from "next/link"
import { Download, Plus, Target } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { readAll, readAllOrThrow } from "@/lib/supabase/read-all"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { todayISO } from "@/lib/dates"
import { formatTHB, formatTHBWhole } from "@/lib/money"
import { earliestDate, type KanbanCard, type KanbanColumn } from "@/lib/kanban"
import {
  expectedRevenue,
  pipelineValue,
  weightedPipelineValue,
  type DealStage,
} from "@/lib/metrics/pipeline"
import { facetLabel, facetValues, matchesFacets, parseFacets, serializeFacets, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { profileNames } from "@/app/(app)/projects/_lib/profile-names"
import { ViewSwitch } from "@/app/(app)/projects/_components/view-switch"

import { DealsBoard } from "./_components/deals-board"
import { dealFacetRow } from "./_lib/deal-facets"

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
const stageIndex = (stage: DealStage) => COLUMNS.findIndex((col) => col.id === stage)

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const params = await searchParams
  const config = parseFacets(params, "deals")
  const view = params.view === "list" ? "list" : "board"
  const facetQuery = serializeFacets(config, "deals")

  const [allDeals, clientsRes, savedViews, nextRes, reasonsRes] = await Promise.all([
    readAllOrThrow((from, to) =>
      supabase
        .from("deals")
        .select(
          "id,title,stage,value_satang,probability,sequence,client_id,owner,expected_close_date,next_follow_up_date,created_at,client:clients(name)"
        )
        .eq("org_id", ctx.orgId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    supabase.from("clients").select("id,name").eq("org_id", ctx.orgId),
    getFacetSavedViews("deals"),
    // Earliest open activity per deal, aggregated in the database.
    readAll((from, to) =>
      supabase
        .from("deal_next_activity")
        .select("deal_id,next_due_date")
        .eq("org_id", ctx.orgId)
        .order("deal_id")
        .range(from, to)
    ),
    supabase.from("deal_lost_reasons").select("id,name").eq("org_id", ctx.orgId).eq("active", true).order("name"),
  ])

  const clients = clientsRes.data ?? []
  const ownerName = await profileNames(supabase, allDeals.map((d) => d.owner))
  const nextActivity = new Map((nextRes.data ?? []).map((r) => [r.deal_id, r.next_due_date]))

  const now = new Date()
  const deals = allDeals.filter((d) =>
    matchesFacets(config, dealFacetRow(d, d.client?.name), ctx.userId, now)
  )

  // When a stage is selected, only show that column.
  const visibleColumns = config.status
    ? COLUMNS.filter((col) => facetValues(config.status).includes(col.id))
    : COLUMNS

  const ownerLabel = (owner: string | null) => (owner && ownerName.get(owner)) || null
  const groups: Record<string, (d: (typeof deals)[number]) => { key: string; label: string }> = {
    stage: (d) => ({ key: d.stage, label: facetLabel(d.stage) }),
    client: (d) => ({ key: d.client_id, label: d.client?.name ?? "Unassigned" }),
    owner: (d) => ({ key: d.owner ?? "", label: ownerLabel(d.owner) ?? "Unassigned" }),
    month: (d) => ({ key: d.expected_close_date?.slice(0, 7) ?? "", label: d.expected_close_date?.slice(0, 7) ?? "No close date" }),
  }
  const group = config.groupBy ? groups[config.groupBy] : undefined
  const listRows = config.groupBy === "stage"
    ? [...deals].sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage))
    : config.groupBy === "month"
      // Undated deals sort last.
      ? [...deals].sort((a, b) => (a.expected_close_date ?? "9999-12-31").localeCompare(b.expected_close_date ?? "9999-12-31"))
      : deals

  // Headline KPIs summarize the whole pipeline, independent of the active filter.
  const openValue = pipelineValue(allDeals)
  const weighted = weightedPipelineValue(allDeals)

  // Saved card order within each column; the stable sort keeps newest first among ties.
  const cards: KanbanCard<DealStage>[] = [...deals].sort((a, b) => a.sequence - b.sequence).map((d) => ({
    id: d.id,
    stage: d.stage,
    title: d.title,
    href: `/deals/${d.id}`,
    amountSatang: d.value_satang,
    probability: d.probability,
    client: d.client?.name ?? null,
    owner: ownerLabel(d.owner),
    due: earliestDate([d.next_follow_up_date, nextActivity.get(d.id) ?? null]),
  }))

  return (
    <div className="space-y-6">
      <PageHeader title="Deals" description="Your sales pipeline and follow-ups.">
        <ViewSwitch path="/deals" query={facetQuery} view={view} defaultView="board" />
        <Button variant="outline" render={<Link href={facetQuery ? `/deals/export?${facetQuery}` : "/deals/export"} />}>
          <Download />
          <span className="sr-only sm:not-sr-only">Export CSV</span>
        </Button>
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
          label="Expected revenue"
          value={formatTHBWhole(weighted)}
          icon={Target}
          hint="Open deals, value × probability"
        />
      </div>

      {allDeals.length === 0 ? null : (
        <SearchFacets
          list="deals"
          config={config}
          savedViews={savedViews}
          params={view === "list" ? { view } : undefined}
        />
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
      ) : view === "list" ? (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Expected close</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Probability</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GroupedTableRows rows={listRows} colSpan={8} group={group} amount={(d) => d.value_satang}>
                  {(d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">
                        <Link href={`/deals/${d.id}`} className="hover:underline">
                          {d.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.client?.name ?? "—"}</TableCell>
                      <TableCell>{facetLabel(d.stage)}</TableCell>
                      <TableCell className="text-muted-foreground">{ownerLabel(d.owner) ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{d.expected_close_date ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTHB(d.value_satang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.probability}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTHB(expectedRevenue(d))}</TableCell>
                    </TableRow>
                  )}
                </GroupedTableRows>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <DealsBoard
          columns={visibleColumns}
          moveTargets={COLUMNS}
          cards={cards}
          clients={clients}
          today={today}
          storageKey={`kanban:deals:${ctx.userId}`}
          lostReasons={reasonsRes.data ?? []}
          canManageReasons={can(ctx.role, "settings:manage")}
        />
      )}
    </div>
  )
}

