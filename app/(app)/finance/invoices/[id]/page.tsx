import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, FileText, PlugZap, Wallet } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { formatTHB, satangToBaht } from "@/lib/money"
import {
  deriveInvoiceStatus,
  outstandingSatang,
} from "@/lib/metrics/invoice-status"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { updateInvoice } from "../../actions"
import { addInvoiceItem, deleteInvoiceItem } from "../../invoice-items-actions"
import {
  InvoiceForm,
  type InvoiceFormValues,
  type InvoiceFormSubmitValues,
} from "../../_components/invoice-form"
import {
  InvoiceItemsEditor,
  type InvoiceItemRow,
} from "../../_components/invoice-items-editor"
import { PaymentForm } from "../../_components/payment-form"
import { SyncInvoiceButton } from "../../_components/sync-invoice-button"
import type { Option } from "../../_components/form-fields"

export const dynamic = "force-dynamic"

const PAYMENT_METHOD_LABEL: Record<Enums<"payment_method">, string> = {
  transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  promptpay: "PromptPay",
  cheque: "Cheque",
  other: "Other",
}

const ACCOUNTING_PROVIDER_LABEL: Record<Enums<"accounting_provider">, string> = {
  flowaccount: "FlowAccount",
  peak: "PEAK",
  xero: "Xero",
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const [
    invoiceRes,
    itemsRes,
    paymentsRes,
    clientsRes,
    projectsRes,
    connRes,
    syncRes,
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, amount_satang, status, issue_date, due_date, is_recurring, recurring_interval, notes, client_id, project_id, clients(name), projects(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("invoice_items")
      .select("id, description, quantity, unit_price_satang, amount_satang")
      .eq("invoice_id", id)
      .order("position", { ascending: true }),
    supabase
      .from("payments")
      .select("id, amount_satang, paid_at, method, notes")
      .eq("invoice_id", id)
      .order("paid_at", { ascending: false }),
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("projects").select("id, name").order("name"),
    supabase
      .from("accounting_connections")
      .select("provider, status")
      .maybeSingle(),
    // One sync-map row exists PER PROVIDER (the unique key includes provider),
    // so after a provider switch there can be several rows for this invoice.
    // Take the most recently synced rather than assuming a single row.
    supabase
      .from("accounting_sync_map")
      .select("external_id, provider, status, last_synced_at")
      .eq("local_entity", "invoice")
      .eq("local_id", id)
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ])

  const invoice = invoiceRes.data
  if (!invoice) notFound()

  const payments = paymentsRes.data ?? []
  const paid = payments.reduce((acc, p) => acc + p.amount_satang, 0)
  const outstanding = outstandingSatang(invoice.amount_satang, paid)
  const effectiveStatus = deriveInvoiceStatus(invoice, paid, today)

  const accountingConnected = connRes.data?.status === "connected"
  const sync = syncRes.data?.[0] ?? null

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: InvoiceFormValues = {
    client_id: invoice.client_id,
    project_id: invoice.project_id ?? "",
    number: invoice.number,
    status: invoice.status,
    issue_date: invoice.issue_date ?? "",
    due_date: invoice.due_date ?? "",
    amountBaht: satangToBaht(invoice.amount_satang),
    is_recurring: invoice.is_recurring,
    recurring_interval: invoice.recurring_interval ?? undefined,
    notes: invoice.notes ?? "",
  }

  // Bind the invoice id into a real server action. The "use client" InvoiceForm
  // can't receive a plain closure across the RSC boundary — it must be a server
  // action reference (like the /new page passes `createInvoice` directly).
  // Capture the narrowed id in a const so the closure doesn't see `invoice` as
  // possibly-null (control-flow narrowing doesn't cross into nested functions).
  const invoiceId = invoice.id
  async function saveInvoice(values: InvoiceFormSubmitValues) {
    "use server"
    return updateInvoice({ id: invoiceId, ...values })
  }

  const itemRows: InvoiceItemRow[] = (itemsRes.data ?? []).map((it) => ({
    id: it.id,
    description: it.description,
    quantity: String(Number(it.quantity)),
    unitPrice: formatTHB(it.unit_price_satang),
    amount: formatTHB(it.amount_satang),
  }))

  async function removeInvoiceItem(input: { id: string }) {
    "use server"
    return deleteInvoiceItem(input)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.number}
        description={invoice.clients?.name ?? "Invoice"}
      >
        {accountingConnected ? (
          <SyncInvoiceButton invoiceId={invoice.id} />
        ) : (
          <Button variant="outline" size="sm" render={<Link href="/settings/accounting" />}>
            <PlugZap /> Connect accounting
          </Button>
        )}
        <Button
          variant="outline"
          render={
            <Link
              href={`/finance/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <FileText /> Download PDF
        </Button>
        <Button variant="outline" render={<Link href="/finance" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Overview</CardTitle>
              <InvoiceStatusBadge status={effectiveStatus} />
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Amount" value={formatTHB(invoice.amount_satang)} />
                <Field label="Paid" value={formatTHB(paid)} />
                <Field
                  label="Outstanding"
                  value={
                    <span className={outstanding > 0 ? "font-medium" : ""}>
                      {formatTHB(outstanding)}
                    </span>
                  }
                />
                <Field label="Issue date" value={invoice.issue_date ?? "—"} />
                <Field label="Due date" value={invoice.due_date ?? "—"} />
                <Field
                  label="Client"
                  value={invoice.clients?.name ?? "—"}
                />
                <Field
                  label="Project"
                  value={invoice.projects?.name ?? "—"}
                />
                <Field
                  label="Recurring"
                  value={
                    invoice.is_recurring
                      ? `Yes · ${invoice.recurring_interval ?? "—"}`
                      : "No"
                  }
                />
                <Field
                  label="Stored status"
                  value={<InvoiceStatusBadge status={invoice.status} />}
                />
                <Field
                  label="Accounting sync"
                  value={
                    sync?.external_id ? (
                      <span className="space-y-0.5">
                        <span className="block font-medium">
                          {ACCOUNTING_PROVIDER_LABEL[sync.provider]} ·{" "}
                          {sync.external_id}
                        </span>
                        {sync.last_synced_at ? (
                          <span className="text-muted-foreground block text-xs">
                            Synced {sync.last_synced_at.slice(0, 10)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not synced</span>
                    )
                  }
                />
              </dl>
              {invoice.notes ? (
                <>
                  <Separator className="my-4" />
                  <Field label="Notes" value={invoice.notes} />
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <InvoiceItemsEditor
                invoiceId={invoice.id}
                items={itemRows}
                addAction={addInvoiceItem}
                deleteAction={removeInvoiceItem}
                locked={invoice.status === "paid"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <EmptyState
                  icon={Wallet}
                  title="No payments yet"
                  description="Record a payment below as the client pays this invoice."
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paid_at}</TableCell>
                        <TableCell>{PAYMENT_METHOD_LABEL[p.method]}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTHB(p.amount_satang)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Record payment</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentForm
                invoiceId={invoice.id}
                today={today}
                suggestedBaht={satangToBaht(outstanding)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Edit invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceForm
            clients={clients}
            projects={projects}
            defaultValues={defaultValues}
            submitLabel="Save changes"
            action={saveInvoice}
          />
        </CardContent>
      </Card>
    </div>
  )
}
