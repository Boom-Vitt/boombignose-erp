import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Wallet } from "lucide-react"

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
import {
  InvoiceForm,
  type InvoiceFormValues,
} from "../../_components/invoice-form"
import { PaymentForm } from "../../_components/payment-form"
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

  const [invoiceRes, paymentsRes, clientsRes, projectsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, amount_satang, status, issue_date, due_date, is_recurring, recurring_interval, notes, client_id, project_id, clients(name), projects(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("payments")
      .select("id, amount_satang, paid_at, method, notes")
      .eq("invoice_id", id)
      .order("paid_at", { ascending: false }),
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("projects").select("id, name").order("name"),
  ])

  const invoice = invoiceRes.data
  if (!invoice) notFound()

  const payments = paymentsRes.data ?? []
  const paid = payments.reduce((acc, p) => acc + p.amount_satang, 0)
  const outstanding = outstandingSatang(invoice.amount_satang, paid)
  const effectiveStatus = deriveInvoiceStatus(invoice, paid, today)

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.number}
        description={invoice.clients?.name ?? "Invoice"}
      >
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
            action={(values) => updateInvoice({ id: invoice.id, ...values })}
          />
        </CardContent>
      </Card>
    </div>
  )
}
