import Link from "next/link"
import {
  FileWarning,
  TrendingUp,
  Flame,
  Repeat,
  FilePlus2,
  ReceiptText,
  Receipt,
  Coins,
} from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { currentMonthKey, todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import {
  revenueForMonth,
  costsForMonth,
  mrr,
  unpaidTotal,
  unpaidCount,
} from "@/lib/metrics/finance"
import {
  deriveInvoiceStatus,
  outstandingSatang,
} from "@/lib/metrics/invoice-status"
import type { Enums } from "@/lib/types/database"

import { Constants } from "@/lib/types/database"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import { DeleteCostButton } from "./_components/delete-cost-button"
import { FinanceToolbar } from "./_components/finance-toolbar"
import type { SavedView } from "@/app/(app)/views/saved-views-menu"
import type { ViewConfig } from "@/app/(app)/views/view-config"

export const dynamic = "force-dynamic"

const INVOICE_STATUSES = Constants.public.Enums.invoice_status

/** Pull the known filter keys out of a saved-view config row. */
function toViewConfig(config: unknown): ViewConfig {
  const c = (config ?? {}) as Record<string, unknown>
  return typeof c.status === "string" ? { status: c.status } : {}
}

const COST_CATEGORY_LABEL: Record<Enums<"cost_category">, string> = {
  software: "Software",
  contractor: "Contractor",
  infra: "Infrastructure",
  marketing: "Marketing",
  salary: "Salary",
  other: "Other",
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const month = currentMonthKey()
  const today = todayISO()

  const { status: statusParam } = await searchParams
  const status = (INVOICE_STATUSES as readonly string[]).includes(
    statusParam ?? ""
  )
    ? statusParam!
    : ""

  const [invoicesRes, paymentsRes, costsRes, viewsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, amount_satang, status, due_date, issue_date, is_recurring, recurring_interval, client_id, clients(name)"
      )
      .order("issue_date", { ascending: false }),
    supabase.from("payments").select("invoice_id, amount_satang, paid_at"),
    supabase
      .from("costs")
      .select(
        "id, category, amount_satang, incurred_on, vendor, project_id, projects(name)"
      )
      .order("incurred_on", { ascending: false }),
    supabase
      .from("saved_views")
      .select("id, name, config")
      .eq("module", "finance")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: true }),
  ])

  const invoices = invoicesRes.data ?? []
  const payments = paymentsRes.data ?? []
  const costs = costsRes.data ?? []

  const savedViews: SavedView[] = (viewsRes.data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    config: toViewConfig(v.config),
  }))

  // Sum payments per invoice.
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    paidByInvoice.set(
      p.invoice_id,
      (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_satang
    )
  }

  const invoiceRows = invoices.map((inv) => {
    const paid = paidByInvoice.get(inv.id) ?? 0
    return {
      ...inv,
      paid_satang: paid,
      outstanding: outstandingSatang(inv.amount_satang, paid),
      effectiveStatus: deriveInvoiceStatus(inv, paid, today),
    }
  })

  // Status filter applies to the stored `status` column (mirrors the export).
  const filteredInvoiceRows = status
    ? invoiceRows.filter((inv) => inv.status === status)
    : invoiceRows

  // Metrics.
  const invoicesWithPaid = invoices.map((inv) => ({
    status: inv.status,
    amount_satang: inv.amount_satang,
    paid_satang: paidByInvoice.get(inv.id) ?? 0,
  }))
  const unpaidSatang = unpaidTotal(invoicesWithPaid)
  const openCount = unpaidCount(invoicesWithPaid)
  const revenueSatang = revenueForMonth(payments, month)
  const costsSatang = costsForMonth(costs, month)
  const mrrSatang = mrr(
    invoices.map((inv) => ({
      status: inv.status,
      amount_satang: inv.amount_satang,
      is_recurring: inv.is_recurring,
      recurring_interval: inv.recurring_interval,
    }))
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Invoices, payments, and operating costs at a glance."
      >
        <Button variant="outline" render={<Link href="/finance/costs/new" />}>
          <Coins /> New cost
        </Button>
        <Button render={<Link href="/finance/invoices/new" />}>
          <FilePlus2 /> New invoice
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Unpaid total"
          value={formatTHB(unpaidSatang)}
          icon={FileWarning}
          tone={openCount > 0 ? "warning" : "default"}
          hint={`${openCount} open invoice${openCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Revenue this month"
          value={formatTHB(revenueSatang)}
          icon={TrendingUp}
          tone="positive"
          hint="Payments received"
        />
        <StatCard
          label="Costs this month"
          value={formatTHB(costsSatang)}
          icon={Flame}
          tone="negative"
          hint="Costs incurred"
        />
        <StatCard
          label="MRR"
          value={formatTHB(mrrSatang)}
          icon={Repeat}
          hint="Recurring revenue / month"
        />
      </div>

      <FinanceToolbar status={status} savedViews={savedViews} />

      <Tabs defaultValue="invoices" className="gap-4">
        <TabsList>
          <TabsTrigger value="invoices">
            <ReceiptText /> Invoices
          </TabsTrigger>
          <TabsTrigger value="costs">
            <Receipt /> Costs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              {invoiceRows.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title="No invoices yet"
                  description="Create your first invoice to start tracking what clients owe."
                  action={
                    <Button render={<Link href="/finance/invoices/new" />}>
                      <FilePlus2 /> New invoice
                    </Button>
                  }
                  className="border-0"
                />
              ) : filteredInvoiceRows.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title="No matching invoices"
                  description="No invoices match the selected status."
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoiceRows.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/finance/invoices/${inv.id}`}
                            className="hover:underline"
                          >
                            {inv.number}
                          </Link>
                          {inv.is_recurring ? (
                            <Repeat
                              className="text-muted-foreground ml-1.5 inline size-3.5 align-text-bottom"
                              aria-label="Recurring"
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>{inv.clients?.name ?? "—"}</TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={inv.effectiveStatus} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTHB(inv.amount_satang)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {inv.due_date ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {inv.outstanding > 0
                            ? formatTHB(inv.outstanding)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Costs</CardTitle>
            </CardHeader>
            <CardContent>
              {costs.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No costs logged"
                  description="Track software, contractors, and other operating costs here."
                  action={
                    <Button render={<Link href="/finance/costs/new" />}>
                      <Coins /> New cost
                    </Button>
                  }
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="w-10" aria-label="Actions" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {COST_CATEGORY_LABEL[c.category]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTHB(c.amount_satang)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.incurred_on}
                        </TableCell>
                        <TableCell>{c.vendor ?? "—"}</TableCell>
                        <TableCell>{c.projects?.name ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <DeleteCostButton
                            id={c.id}
                            label={`${COST_CATEGORY_LABEL[c.category]} cost`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
